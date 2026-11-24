import { filterModelsForTask } from '@/lib/data/queries';
import {
  computeSessionViability,
  resolveEffectiveLimits,
  sortProviderOfferings,
  type SessionViabilityLevel,
} from '@/lib/providers/limits';
import { getProvidersConfig } from '@/lib/providers/types';
import type {
  AccessMode,
  FreeTierType,
  LeaderboardModel,
  ProviderOffering,
  ProviderSlug,
} from '@/lib/supabase/types';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export interface RoutedEndpoint {
  canonical_id: string;
  display_name: string;
  score: number | null;
  context_window: number | null;
  provider_slug: ProviderSlug;
  provider_model_id: string;
  base_url: string;
  env_var: string;
  openai_compatible: boolean;
  access_mode: AccessMode;
  harness_name: string | null;
  tier_type: FreeTierType;
  trains_on_data: boolean;
  rpm_limit: string;
  rpd_limit: string;
  session_viability: SessionViabilityLevel;
}

export interface RouteSelectionResponse {
  task: string;
  recommended: RoutedEndpoint | null;
  fallbacks: RoutedEndpoint[];
  count: number;
  generated_at: string;
}

function isTruthyParam(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function getEffectiveBaseUrl(slug: ProviderSlug, configuredBaseUrl: string): string {
  if (slug === 'cloudflare') {
    return 'https://api.cloudflare.com/client/v4/accounts/<YOUR_CLOUDFLARE_ACCOUNT_ID>/ai/v1';
  }
  return configuredBaseUrl;
}

function getTaskScoreValue(model: LeaderboardModel, task: string): number | null {
  switch (task) {
    case 'agentic-coding':
      return model.agentic_coding_score ?? model.freebench_score;
    case 'coding':
      return model.livebench_coding ?? model.freebench_score;
    case 'reasoning':
      return model.livebench_reasoning ?? model.freebench_score;
    case 'math':
      return model.livebench_math ?? model.freebench_score;
    case 'tool-calling':
      return model.bfcl_overall ?? model.freebench_score;
    default:
      return model.freebench_score;
  }
}

function buildRoutedEndpoint(
  model: LeaderboardModel,
  offering: ProviderOffering,
  task: string
): RoutedEndpoint {
  const cfg = getProvidersConfig()[offering.provider_slug];
  const limits = resolveEffectiveLimits(offering);
  const viability = computeSessionViability(offering);

  return {
    canonical_id: model.canonical_id,
    display_name: model.display_name,
    score: getTaskScoreValue(model, task),
    context_window: offering.context_window ?? model.context_window,
    provider_slug: offering.provider_slug,
    provider_model_id: offering.provider_model_id,
    base_url: getEffectiveBaseUrl(offering.provider_slug, cfg.api_base_url),
    env_var: cfg.env_var,
    openai_compatible: cfg.openai_compatible,
    access_mode: cfg.access_mode,
    harness_name: cfg.harness_name ?? null,
    tier_type: offering.tier_type,
    trains_on_data: offering.trains_on_data,
    rpm_limit: limits.rpmLabel,
    rpd_limit: limits.rpdLabel,
    session_viability: viability.level,
  };
}

/**
 * Filters leaderboard models via URL query parameters for `/api/v1/models` and `/api/v1/route`.
 */
export function filterApiModels(
  models: LeaderboardModel[],
  params: URLSearchParams
): LeaderboardModel[] {
  const task = params.get('task')?.trim() || '';
  const alwaysFree = isTruthyParam(params.get('always_free'));
  const directApi = isTruthyParam(params.get('direct_api'));
  const zeroTraining = isTruthyParam(params.get('zero_training'));
  const tools = isTruthyParam(params.get('tools'));
  const vision = isTruthyParam(params.get('vision'));
  const openWeights = isTruthyParam(params.get('open_weights'));
  const minContext = Number(params.get('min_context') ?? '0');
  const query = params.get('q')?.trim().toLowerCase() ?? '';
  const providerRaw = params.get('provider')?.trim() ?? '';
  const providersConfig = getProvidersConfig();
  const validProviderSet = new Set(Object.keys(providersConfig));
  const providerFilter = providerRaw
    ? new Set(
        providerRaw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => validProviderSet.has(s))
      )
    : null;

  const baseList = task ? filterModelsForTask(models, task) : [...models];

  const filtered = baseList
    .map((model) => {
      const matchingProviders = sortProviderOfferings(
        model.providers.filter((p) => {
          if (alwaysFree && p.tier_type !== 'always_free') return false;
          if (directApi && providersConfig[p.provider_slug]?.access_mode === 'harness_only') {
            return false;
          }
          if (zeroTraining && p.trains_on_data) return false;
          if (providerFilter && providerFilter.size > 0 && !providerFilter.has(p.provider_slug)) {
            return false;
          }
          return true;
        })
      );

      return {
        ...model,
        providers: matchingProviders,
        active_provider_count: matchingProviders.length,
      };
    })
    .filter((model) => {
      if (model.providers.length === 0) return false;
      if (tools && model.supports_tools !== true) return false;
      if (vision && model.supports_vision !== true) return false;
      if (openWeights && model.is_open_weights !== true) return false;
      if (Number.isFinite(minContext) && minContext > 0 && (model.context_window ?? 0) < minContext) {
        return false;
      }
      if (query) {
        const hay = [
          model.canonical_id,
          model.display_name,
          model.family ?? '',
          ...model.providers.map((p) => `${p.provider_slug} ${p.provider_model_id}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

  const rawLimit = params.get('limit');
  if (rawLimit !== null) {
    const parsedLimit = Number(rawLimit);
    if (Number.isFinite(parsedLimit) && parsedLimit >= 1) {
      return filtered.slice(0, Math.min(100, Math.floor(parsedLimit)));
    }
  }

  return filtered;
}

/**
 * Selects the optimal primary free endpoint and distinct-provider fallbacks for agent routers.
 */
export function selectBestRoute(
  models: LeaderboardModel[],
  params: URLSearchParams
): RouteSelectionResponse {
  const task = params.get('task')?.trim() || 'agentic-coding';
  const cloned = new URLSearchParams(params.toString());
  if (!cloned.has('task')) {
    cloned.set('task', task);
  }
  cloned.delete('limit');

  const candidates = filterApiModels(models, cloned);
  if (candidates.length === 0) {
    return {
      task,
      recommended: null,
      fallbacks: [],
      count: 0,
      generated_at: new Date().toISOString(),
    };
  }

  const topModel = candidates[0]!;
  const primaryOffering = topModel.providers[0]!;
  const recommended = buildRoutedEndpoint(topModel, primaryOffering, task);

  const fallbacks: RoutedEndpoint[] = [];
  const usedProviders = new Set<ProviderSlug>([recommended.provider_slug]);
  const usedPairs = new Set<string>([
    `${recommended.provider_slug}:${recommended.provider_model_id}`,
  ]);

  for (const model of candidates) {
    for (const offering of model.providers) {
      if (fallbacks.length >= 4) break;
      const pairKey = `${offering.provider_slug}:${offering.provider_model_id}`;
      if (usedProviders.has(offering.provider_slug) || usedPairs.has(pairKey)) continue;
      fallbacks.push(buildRoutedEndpoint(model, offering, task));
      usedProviders.add(offering.provider_slug);
      usedPairs.add(pairKey);
    }
    if (fallbacks.length >= 4) break;
  }

  if (fallbacks.length < 4) {
    for (const model of candidates) {
      for (const offering of model.providers) {
        if (fallbacks.length >= 4) break;
        const pairKey = `${offering.provider_slug}:${offering.provider_model_id}`;
        if (usedPairs.has(pairKey)) continue;
        fallbacks.push(buildRoutedEndpoint(model, offering, task));
        usedPairs.add(pairKey);
      }
      if (fallbacks.length >= 4) break;
    }
  }

  return {
    task,
    recommended,
    fallbacks,
    count: 1 + fallbacks.length,
    generated_at: new Date().toISOString(),
  };
}
