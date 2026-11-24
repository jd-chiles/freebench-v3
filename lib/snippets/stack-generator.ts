import type { SortCategory } from '@/lib/leaderboard/url-state';
import {
  computeSessionViability,
  resolveEffectiveLimits,
  sortProviderOfferings,
  type SessionViability,
} from '@/lib/providers/limits';
import { KEYLESS_PROVIDERS } from '@/lib/providers/my-keys';
import { getProvidersConfig } from '@/lib/providers/types';
import type { LeaderboardModel, ProviderOffering, ProviderSlug } from '@/lib/supabase/types';

export interface StackBuilderOptions {
  ownedProviders: ProviderSlug[];
  task: SortCategory;
  alwaysFreeOnly: boolean;
  directApiOnly?: boolean;
  zeroTrainingOnly: boolean;
  minContext: number;
  maxRoutes?: number;
}

export interface StackRoute {
  canonicalId: string;
  displayName: string;
  score: number | null;
  offering: ProviderOffering;
  viability: SessionViability;
  envVar: string;
  baseUrl: string;
  isKeyless: boolean;
}

export interface GeneratedStackConfig {
  id: 'litellm' | 'opencode' | 'openrouter-ts' | 'env';
  label: string;
  filename: string;
  language: string;
  code: string;
}

const KEYLESS_SET = new Set<ProviderSlug>(KEYLESS_PROVIDERS);

function getTaskScore(model: LeaderboardModel, task: SortCategory): number | null {
  switch (task) {
    case 'agentic':
      return model.agentic_coding_score ?? model.freebench_score;
    case 'coding':
      return model.livebench_coding ?? model.freebench_score;
    case 'reasoning':
      return model.livebench_reasoning ?? model.freebench_score;
    case 'math':
      return model.livebench_math ?? model.freebench_score;
    case 'tools':
      return model.bfcl_overall ?? model.freebench_score;
    case 'overall':
    default:
      return model.freebench_score;
  }
}

function getEffectiveBaseUrl(slug: ProviderSlug, configuredBaseUrl: string): string {
  if (slug === 'cloudflare') {
    return 'https://api.cloudflare.com/client/v4/accounts/<YOUR_CLOUDFLARE_ACCOUNT_ID>/ai/v1';
  }
  return configuredBaseUrl;
}

function getEffectiveApiKeyConfig(
  slug: ProviderSlug,
  envVar: string
): { opencode: string; litellm: string; tsExpr: string } {
  if (slug === 'pollinations') {
    return {
      opencode: 'pollinations',
      litellm: 'pollinations',
      tsExpr: '"pollinations"',
    };
  }
  return {
    opencode: `{env:${envVar}}`,
    litellm: `os.environ/${envVar}`,
    tsExpr: `process.env.${envVar} ?? ""`,
  };
}

/**
 * Selects a ranked, multi-provider free failover chain and generates copy-ready
 * configs for LiteLLM Proxy, OpenCode (`opencode.json`), TypeScript/OpenRouter, and `.env`.
 */
export function buildFallbackStack(
  models: LeaderboardModel[],
  options: StackBuilderOptions
): {
  routes: StackRoute[];
  smallRoute: StackRoute | null;
  configs: GeneratedStackConfig[];
} {
  const providersConfig = getProvidersConfig();
  const ownedSet = new Set(options.ownedProviders);
  const maxRoutes = options.maxRoutes ?? 5;

  const rankedModels = [...models]
    .filter((model) => {
      if (options.task === 'agentic' && model.supports_tools === false) return false;
      if (options.task === 'tools' && model.supports_tools !== true) return false;
      if (options.minContext > 0 && (model.context_window ?? 0) < options.minContext) return false;
      return true;
    })
    .sort((a, b) => (getTaskScore(b, options.task) ?? -1) - (getTaskScore(a, options.task) ?? -1));

  const candidateRoutes: StackRoute[] = [];

  for (const model of rankedModels) {
    const eligibleOfferings = sortProviderOfferings(
      model.providers.filter((p) => {
        if (ownedSet.size > 0 && !ownedSet.has(p.provider_slug)) return false;
        if (options.alwaysFreeOnly && p.tier_type !== 'always_free') return false;
        if (
          options.directApiOnly &&
          providersConfig[p.provider_slug]?.access_mode === 'harness_only'
        ) {
          return false;
        }
        if (options.zeroTrainingOnly && p.trains_on_data) return false;
        return true;
      })
    );

    if (eligibleOfferings.length === 0) continue;

    for (const offering of eligibleOfferings) {
      const cfg = providersConfig[offering.provider_slug];
      candidateRoutes.push({
        canonicalId: model.canonical_id,
        displayName: model.display_name,
        score: getTaskScore(model, options.task),
        offering,
        viability: computeSessionViability(offering),
        envVar: cfg.env_var,
        baseUrl: getEffectiveBaseUrl(offering.provider_slug, cfg.api_base_url),
        isKeyless: KEYLESS_SET.has(offering.provider_slug),
      });
    }
  }

  // First pass: pick highest-scoring route across distinct providers for resilient 429 failover
  const selectedRoutes: StackRoute[] = [];
  const usedProviders = new Set<ProviderSlug>();
  const usedPairs = new Set<string>();

  for (const candidate of candidateRoutes) {
    if (selectedRoutes.length >= maxRoutes) break;
    const pairKey = `${candidate.offering.provider_slug}:${candidate.offering.provider_model_id}`;
    if (usedProviders.has(candidate.offering.provider_slug) || usedPairs.has(pairKey)) continue;
    selectedRoutes.push(candidate);
    usedProviders.add(candidate.offering.provider_slug);
    usedPairs.add(pairKey);
  }

  // Second pass: top up remaining slots up to maxRoutes if user owns fewer than maxRoutes providers
  if (selectedRoutes.length < maxRoutes) {
    for (const candidate of candidateRoutes) {
      if (selectedRoutes.length >= maxRoutes) break;
      const pairKey = `${candidate.offering.provider_slug}:${candidate.offering.provider_model_id}`;
      if (usedPairs.has(pairKey)) continue;
      selectedRoutes.push(candidate);
      usedPairs.add(pairKey);
    }
  }

  // Pick a high-RPD / fast secondary route for OpenCode `small_model`
  const smallRoute =
    selectedRoutes.find((r) => {
      if (selectedRoutes.length > 1 && r === selectedRoutes[0]) return false;
      const limits = resolveEffectiveLimits(r.offering);
      return limits.rpdInt === null || limits.rpdInt >= 200;
    }) ??
    selectedRoutes[1] ??
    selectedRoutes[0] ??
    null;

  if (selectedRoutes.length === 0) {
    return {
      routes: [],
      smallRoute: null,
      configs: [],
    };
  }

  // 1. LiteLLM Proxy YAML with cooldown failover
  const litellmEntries = selectedRoutes.map((route) => {
    const keyCfg = getEffectiveApiKeyConfig(route.offering.provider_slug, route.envVar);
    return `  - model_name: free-${options.task}
    litellm_params:
      model: openai/${route.offering.provider_model_id}
      api_base: ${route.baseUrl}
      api_key: ${keyCfg.litellm}`;
  });

  const litellmCode = `model_list:
${litellmEntries.join('\n')}

router_settings:
  routing_strategy: simple-shuffle
  num_retries: 3
  allowed_fails: 1
  cooldown_time: 60`;

  // 2. OpenCode strict JSON config
  const openCodeProviders: Record<string, unknown> = {};
  for (const route of selectedRoutes) {
    const slug = route.offering.provider_slug;
    const keyCfg = getEffectiveApiKeyConfig(slug, route.envVar);
    if (slug === 'google') {
      openCodeProviders.google = {
        options: {
          apiKey: keyCfg.opencode,
        },
      };
      continue;
    }

    const existing = openCodeProviders[slug] as
      | { npm: string; options: { baseURL: string; apiKey: string }; models: Record<string, unknown> }
      | undefined;
    if (existing) {
      existing.models[route.offering.provider_model_id] = {};
    } else {
      openCodeProviders[slug] = {
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: route.baseUrl,
          apiKey: keyCfg.opencode,
        },
        models: {
          [route.offering.provider_model_id]: {},
        },
      };
    }
  }

  const primaryRoute = selectedRoutes[0]!;
  const openCodeObj = {
    $schema: 'https://opencode.ai/config.json',
    provider: openCodeProviders,
    model: `${primaryRoute.offering.provider_slug}/${primaryRoute.offering.provider_model_id}`,
    ...(smallRoute
      ? {
          small_model: `${smallRoute.offering.provider_slug}/${smallRoute.offering.provider_model_id}`,
        }
      : {}),
  };

  // 3. TypeScript + OpenRouter failover array
  const openRouterRoutes = selectedRoutes.filter((r) => r.offering.provider_slug === 'openrouter');
  const openRouterBlock =
    openRouterRoutes.length > 0
      ? `// OpenRouter native fallback array:\nconst openRouterFallbackModels = ${JSON.stringify(
          openRouterRoutes.map((r) => r.offering.provider_model_id),
          null,
          2
        )};\n\n`
      : '';

  const tsRoutesLiteral = selectedRoutes
    .filter((r) => r.offering.provider_slug !== 'google' || r.baseUrl.includes('v1beta'))
    .map((r) => {
      const keyCfg = getEffectiveApiKeyConfig(r.offering.provider_slug, r.envVar);
      const openaiBase =
        r.offering.provider_slug === 'google'
          ? 'https://generativelanguage.googleapis.com/v1beta/openai'
          : r.baseUrl;
      return `  { provider: ${JSON.stringify(r.offering.provider_slug)}, baseURL: ${JSON.stringify(openaiBase)}, model: ${JSON.stringify(r.offering.provider_model_id)}, apiKey: ${keyCfg.tsExpr} }`;
    })
    .join(',\n');

  const tsCode = `import OpenAI from "openai";

${openRouterBlock}const FREE_STACK = [
${tsRoutesLiteral}
];

export async function runWithFreeFallback(prompt: string): Promise<string> {
  for (const target of FREE_STACK) {
    if (!target.apiKey) continue;
    try {
      const client = new OpenAI({ baseURL: target.baseURL, apiKey: target.apiKey });
      const res = await client.chat.completions.create({
        model: target.model,
        messages: [{ role: "user", content: prompt }],
      });
      return res.choices[0]?.message?.content ?? "";
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 429 || (status && status >= 500)) continue;
      throw error;
    }
  }
  throw new Error("All free-tier stack routes exhausted");
}`;

  // 4. .env.example
  const seenEnv = new Set<string>();
  const envLines: string[] = [];
  for (const route of selectedRoutes) {
    if (route.offering.provider_slug === 'pollinations') continue;
    if (seenEnv.has(route.envVar)) continue;
    seenEnv.add(route.envVar);
    const cfg = providersConfig[route.offering.provider_slug];
    envLines.push(`# ${cfg.display_name}: ${cfg.signup_url}`);
    envLines.push(`${route.envVar}=`);
  }
  const envCode =
    envLines.length > 0
      ? envLines.join('\n')
      : '# Selected routes use anonymous zero-key access (no API key required).';

  return {
    routes: selectedRoutes,
    smallRoute,
    configs: [
      {
        id: 'litellm',
        label: 'LiteLLM Proxy',
        filename: 'litellm_config.yaml',
        language: 'yaml',
        code: litellmCode,
      },
      {
        id: 'opencode',
        label: 'OpenCode',
        filename: 'opencode.json',
        language: 'json',
        code: JSON.stringify(openCodeObj, null, 2),
      },
      {
        id: 'openrouter-ts',
        label: 'TS Failover',
        filename: 'free-stack.ts',
        language: 'typescript',
        code: tsCode,
      },
      {
        id: 'env',
        label: '.env Keys',
        filename: '.env.example',
        language: 'bash',
        code: envCode,
      },
    ],
  };
}
