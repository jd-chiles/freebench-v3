import { unstable_cache } from 'next/cache';
import agentPortalsRaw from '@/config/agent-portals.json';
import { getPulseSourcesConfig } from '@/lib/pulse/types';
import { getProvidersConfig } from '@/lib/providers/types';
import sponsorsRaw from '@/config/sponsors.json';
import seedSnapshotRaw from '@/data/seed-snapshot.json';
import { getSupabaseAnonClient } from '@/lib/supabase/client';
import type {
  AccessMode,
  AvailabilityEventRecord,
  FreeTierType,
  LeaderboardModel,
  ProviderSlug,
  PulseItemRecord,
  SyncRunRecord,
  UnmappedEntityRecord,
} from '@/lib/supabase/types';

export interface AgentPortalEntry {
  slug: string;
  name: string;
  access_mode: AccessMode;
  harness_name: string | null;
  tier_type: FreeTierType;
  tier_label: string;
  target_agents: string[];
  highlights: string;
  limits_note: string;
  url: string;
  signup_note: string;
  direct_api_provider_slug: ProviderSlug | null;
}

export interface SponsorConfig {
  active_sponsor: {
    name: string;
    tagline: string;
    cta_label: string;
    url: string;
    badge?: string;
  } | null;
}

export interface TaskDefinition {
  slug: string;
  title: string;
  shortLabel: string;
  description: string;
  heroQuestion: string;
  faqAnswerPrefix: string;
}

export const TASK_DEFINITIONS: readonly TaskDefinition[] = [
  {
    slug: 'agentic-coding',
    title: 'Best Free LLMs for Agentic Coding (OpenCode, Hermes, Freebuff, Cline)',
    shortLabel: 'Agentic Coding',
    description:
      'Ranked by coding accuracy, BFCL tool-calling reliability, reasoning, and context headroom across free API tiers.',
    heroQuestion: 'What is the best free LLM for agentic coding right now?',
    faqAnswerPrefix:
      'For autonomous coding loops (OpenCode, Hermes Agent, Freebuff, Cline, Aider), models need reliable function calling, high coding scores, and generous daily token/request limits.',
  },
  {
    slug: 'coding',
    title: 'Best Free LLMs for Coding & Software Engineering',
    shortLabel: 'Coding',
    description:
      'Top zero-cost LLM APIs ranked by LiveBench Coding scores with live RPM/RPD limits.',
    heroQuestion: 'What is the best free LLM for coding right now?',
    faqAnswerPrefix:
      'Models below are ranked strictly by LiveBench Coding accuracy while verified live on free-tier APIs.',
  },
  {
    slug: 'reasoning',
    title: 'Best Free LLMs for Reasoning & Complex Problem Solving',
    shortLabel: 'Reasoning',
    description:
      'Live-verified free reasoning models ranked by LiveBench Reasoning and Epoch ECI scores.',
    heroQuestion: 'What is the best free LLM for reasoning right now?',
    faqAnswerPrefix:
      'Ranked by LiveBench Reasoning performance across free API endpoints with zero credit card required.',
  },
  {
    slug: 'math',
    title: 'Best Free LLMs for Math & Quantitative Tasks',
    shortLabel: 'Math',
    description:
      'Zero-cost models ranked by LiveBench Math performance across free developer endpoints.',
    heroQuestion: 'What is the best free LLM for math right now?',
    faqAnswerPrefix:
      'Models below are sorted by LiveBench Math scores and verified live across free API providers.',
  },
  {
    slug: 'tool-calling',
    title: 'Best Free LLMs for Tool Calling & Function Calling (BFCL)',
    shortLabel: 'Tool Calling',
    description:
      'Free LLM APIs that support structured tool calls, ranked by Berkeley Function Calling Leaderboard (BFCL).',
    heroQuestion: 'What is the best free LLM for tool calling right now?',
    faqAnswerPrefix:
      'Filtered to models advertising tool/function calling support and ranked by BFCL Overall Accuracy.',
  },
  {
    slug: 'vision',
    title: 'Best Free Multimodal & Vision LLMs',
    shortLabel: 'Vision',
    description:
      'Free-tier models supporting image inputs, ranked by FreeBench Composite Score.',
    heroQuestion: 'What is the best free vision LLM right now?',
    faqAnswerPrefix:
      'Filtered to models with verified image-input support on zero-cost developer APIs.',
  },
  {
    slug: 'long-context',
    title: 'Best Free Long-Context LLMs (128K–1M+ Tokens)',
    shortLabel: 'Long Context',
    description:
      'Free LLM APIs with 128K+ to 1M+ token context windows for whole-repo and document workflows.',
    heroQuestion: 'What is the best free long-context LLM right now?',
    faqAnswerPrefix:
      'Filtered to models offering at least 128,000 tokens of context window on active free tiers.',
  },
  {
    slug: 'always-free',
    title: 'Best Always-Free LLMs (No One-Time Trial Credits)',
    shortLabel: 'Always Free',
    description:
      'Ongoing recurring free-tier LLM APIs (OpenRouter, Groq, Google AI Studio, Cloudflare, Mistral, SambaNova) — excludes one-time trial credits.',
    heroQuestion: 'What is the best always-free LLM API with ongoing free limits?',
    faqAnswerPrefix:
      'Filtered strictly to recurring always-free provider tiers, excluding one-time signup credits like Cerebras $5 trial credit.',
  },
  {
    slug: 'privacy',
    title: 'Best Free LLMs With Zero Data Training',
    shortLabel: 'Zero Data Training',
    description:
      'Privacy-safe free LLM APIs excluding providers that train on free-tier prompts.',
    heroQuestion: 'What is the best free LLM that does not train on my data?',
    faqAnswerPrefix:
      'Filtered strictly to provider offerings with trains_on_data = false (automatically excluding Google AI Studio free tier and Mistral Free mode).',
  },
  {
    slug: 'open-weights',
    title: 'Best Free Open-Weights LLMs via Hosted APIs',
    shortLabel: 'Open Weights',
    description:
      'Open-weight models (DeepSeek, Qwen, Llama, Mistral, GPT-OSS, Gemma) served free on hosted inference clouds.',
    heroQuestion: 'What is the best free open-weights LLM API right now?',
    faqAnswerPrefix:
      'Filtered to open-weight models you can call via free hosted APIs today or self-host later with zero vendor lock-in.',
  },
];

interface SeedSnapshotShape {
  models: LeaderboardModel[];
  sync_runs: SyncRunRecord[];
  availability_events: AvailabilityEventRecord[];
  pulse_items: PulseItemRecord[];
  unmapped_entities: UnmappedEntityRecord[];
}

function getSeedSnapshot(): SeedSnapshotShape {
  return seedSnapshotRaw as SeedSnapshotShape;
}

export function getAgentPortals(): AgentPortalEntry[] {
  return agentPortalsRaw as AgentPortalEntry[];
}

export function getActiveSponsor(): SponsorConfig['active_sponsor'] {
  const parsed = sponsorsRaw as SponsorConfig;
  return parsed.active_sponsor;
}

export function getXWatchlist() {
  const config = getPulseSourcesConfig();
  return {
    xListUrl: config.x_list_url ?? null,
    watchlist: config.x_watchlist,
  };
}

async function fetchLeaderboardDataUncached(): Promise<{
  models: LeaderboardModel[];
  latestSync: SyncRunRecord | null;
  recentPulse: PulseItemRecord[];
  isDemoData: boolean;
}> {
  const seed = getSeedSnapshot();
  const supabase = getSupabaseAnonClient();

  if (!supabase) {
    return {
      models: seed.models,
      latestSync: seed.sync_runs[0] ?? null,
      recentPulse: seed.pulse_items.slice(0, 4),
      isDemoData: true,
    };
  }

  try {
    const [modelsRes, syncRes, pulseRes] = await Promise.all([
      supabase.from('v_leaderboard_models').select('*'),
      supabase
        .from('sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1),
      supabase
        .from('pulse_items')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(4),
    ]);

    if (modelsRes.error) {
      throw modelsRes.error;
    }

    const models = (modelsRes.data ?? []) as LeaderboardModel[];
    const latestSync = ((syncRes.data ?? [])[0] as SyncRunRecord | undefined) ?? null;
    const recentPulse = (pulseRes.data ?? []) as PulseItemRecord[];

    if (models.length === 0 && !latestSync) {
      return {
        models: seed.models,
        latestSync: seed.sync_runs[0] ?? null,
        recentPulse: seed.pulse_items.slice(0, 4),
        isDemoData: true,
      };
    }

    return {
      models,
      latestSync,
      recentPulse,
      isDemoData: false,
    };
  } catch {
    return {
      models: seed.models,
      latestSync: seed.sync_runs[0] ?? null,
      recentPulse: seed.pulse_items.slice(0, 4),
      isDemoData: true,
    };
  }
}

const getLeaderboardDataCached = unstable_cache(
  fetchLeaderboardDataUncached,
  ['freebench-leaderboard-data'],
  { tags: ['leaderboard'], revalidate: 3600 }
);

export async function getLeaderboardData() {
  try {
    return await getLeaderboardDataCached();
  } catch {
    return fetchLeaderboardDataUncached();
  }
}

export async function getModelById(canonicalId: string): Promise<{
  model: LeaderboardModel | null;
  latestSync: SyncRunRecord | null;
  isDemoData: boolean;
}> {
  const { models, latestSync, isDemoData } = await getLeaderboardData();
  const decoded = decodeURIComponent(canonicalId);
  const model = models.find((m) => m.canonical_id === decoded) ?? null;
  return { model, latestSync, isDemoData };
}

export async function getProviderPageData(providerSlug: ProviderSlug): Promise<{
  models: LeaderboardModel[];
  latestSync: SyncRunRecord | null;
  isDemoData: boolean;
}> {
  const { models, latestSync, isDemoData } = await getLeaderboardData();
  const filtered = models.filter((model) =>
    model.providers.some((p) => p.provider_slug === providerSlug)
  );
  return { models: filtered, latestSync, isDemoData };
}

async function fetchPulsePageDataUncached(): Promise<{
  items: PulseItemRecord[];
  latestSync: SyncRunRecord | null;
  isDemoData: boolean;
}> {
  const seed = getSeedSnapshot();
  const supabase = getSupabaseAnonClient();

  if (!supabase) {
    return {
      items: seed.pulse_items,
      latestSync: seed.sync_runs[0] ?? null,
      isDemoData: true,
    };
  }

  try {
    const [pulseRes, syncRes] = await Promise.all([
      supabase
        .from('pulse_items')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(100),
      supabase
        .from('sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1),
    ]);

    if (pulseRes.error) throw pulseRes.error;
    const items = (pulseRes.data ?? []) as PulseItemRecord[];
    const latestSync = ((syncRes.data ?? [])[0] as SyncRunRecord | undefined) ?? null;

    if (items.length === 0 && !latestSync) {
      return {
        items: seed.pulse_items,
        latestSync: seed.sync_runs[0] ?? null,
        isDemoData: true,
      };
    }

    return { items, latestSync, isDemoData: false };
  } catch {
    return {
      items: seed.pulse_items,
      latestSync: seed.sync_runs[0] ?? null,
      isDemoData: true,
    };
  }
}

const getPulsePageDataCached = unstable_cache(
  fetchPulsePageDataUncached,
  ['freebench-pulse-data'],
  { tags: ['leaderboard'], revalidate: 3600 }
);

export async function getPulsePageData() {
  try {
    return await getPulsePageDataCached();
  } catch {
    return fetchPulsePageDataUncached();
  }
}

async function fetchChangelogEventsUncached(): Promise<{
  events: AvailabilityEventRecord[];
  latestSync: SyncRunRecord | null;
  isDemoData: boolean;
}> {
  const seed = getSeedSnapshot();
  const supabase = getSupabaseAnonClient();

  if (!supabase) {
    return {
      events: seed.availability_events,
      latestSync: seed.sync_runs[0] ?? null,
      isDemoData: true,
    };
  }

  try {
    const [eventsRes, syncRes] = await Promise.all([
      supabase
        .from('availability_events')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(80),
      supabase
        .from('sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1),
    ]);

    if (eventsRes.error) throw eventsRes.error;
    const events = (eventsRes.data ?? []) as AvailabilityEventRecord[];
    const latestSync = ((syncRes.data ?? [])[0] as SyncRunRecord | undefined) ?? null;

    if (events.length === 0 && !latestSync) {
      return {
        events: seed.availability_events,
        latestSync: seed.sync_runs[0] ?? null,
        isDemoData: true,
      };
    }

    return { events, latestSync, isDemoData: false };
  } catch {
    return {
      events: seed.availability_events,
      latestSync: seed.sync_runs[0] ?? null,
      isDemoData: true,
    };
  }
}

const getChangelogEventsCached = unstable_cache(
  fetchChangelogEventsUncached,
  ['freebench-changelog-events'],
  { tags: ['leaderboard'], revalidate: 3600 }
);

export async function getChangelogEvents() {
  try {
    return await getChangelogEventsCached();
  } catch {
    return fetchChangelogEventsUncached();
  }
}

async function fetchStatusPageDataUncached(): Promise<{
  syncRuns: SyncRunRecord[];
  unmappedEntities: UnmappedEntityRecord[];
  providerModelCounts: Record<ProviderSlug, number>;
  isDemoData: boolean;
}> {
  const seed = getSeedSnapshot();
  const providersConfig = getProvidersConfig();
  const providerSlugs = Object.keys(providersConfig) as ProviderSlug[];

  const computeCounts = (models: LeaderboardModel[]): Record<ProviderSlug, number> => {
    const counts = Object.fromEntries(providerSlugs.map((slug) => [slug, 0])) as Record<
      ProviderSlug,
      number
    >;
    for (const model of models) {
      for (const p of model.providers) {
        if (p.provider_slug in counts) {
          counts[p.provider_slug] += 1;
        }
      }
    }
    return counts;
  };

  const supabase = getSupabaseAnonClient();
  if (!supabase) {
    return {
      syncRuns: seed.sync_runs,
      unmappedEntities: seed.unmapped_entities,
      providerModelCounts: computeCounts(seed.models),
      isDemoData: true,
    };
  }

  try {
    const [runsRes, unmappedRes, modelsData] = await Promise.all([
      supabase.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(20),
      supabase
        .from('unmapped_entities')
        .select('*')
        .eq('status', 'pending')
        .order('seen_count', { ascending: false })
        .limit(100),
      fetchLeaderboardDataUncached(),
    ]);

    if (runsRes.error) throw runsRes.error;
    const syncRuns = (runsRes.data ?? []) as SyncRunRecord[];
    const unmappedEntities = (unmappedRes.data ?? []) as UnmappedEntityRecord[];

    if (syncRuns.length === 0 && modelsData.isDemoData) {
      return {
        syncRuns: seed.sync_runs,
        unmappedEntities: seed.unmapped_entities,
        providerModelCounts: computeCounts(seed.models),
        isDemoData: true,
      };
    }

    return {
      syncRuns,
      unmappedEntities,
      providerModelCounts: computeCounts(modelsData.models),
      isDemoData: modelsData.isDemoData,
    };
  } catch {
    return {
      syncRuns: seed.sync_runs,
      unmappedEntities: seed.unmapped_entities,
      providerModelCounts: computeCounts(seed.models),
      isDemoData: true,
    };
  }
}

const getStatusPageDataCached = unstable_cache(
  fetchStatusPageDataUncached,
  ['freebench-status-data'],
  { tags: ['leaderboard'], revalidate: 3600 }
);

export async function getStatusPageData() {
  try {
    return await getStatusPageDataCached();
  } catch {
    return fetchStatusPageDataUncached();
  }
}

export function filterModelsForTask(models: LeaderboardModel[], taskSlug: string): LeaderboardModel[] {
  const byMetric = (
    list: LeaderboardModel[],
    getter: (m: LeaderboardModel) => number | null
  ): LeaderboardModel[] =>
    [...list]
      .filter((m) => getter(m) !== null)
      .sort((a, b) => (getter(b) ?? -1) - (getter(a) ?? -1));

  switch (taskSlug) {
    case 'agentic-coding':
      return byMetric(
        models.filter((m) => m.supports_tools !== false),
        (m) => m.agentic_coding_score
      );
    case 'coding':
      return byMetric(models, (m) => m.livebench_coding);
    case 'reasoning':
      return byMetric(models, (m) => m.livebench_reasoning);
    case 'math':
      return byMetric(models, (m) => m.livebench_math);
    case 'tool-calling':
      return byMetric(
        models.filter((m) => m.supports_tools === true),
        (m) => m.bfcl_overall
      );
    case 'vision':
      return [...models]
        .filter((m) => m.supports_vision === true)
        .sort((a, b) => (b.freebench_score ?? -1) - (a.freebench_score ?? -1));
    case 'long-context':
      return [...models]
        .filter((m) => (m.context_window ?? 0) >= 128_000)
        .sort((a, b) => {
          const ctxDiff = (b.context_window ?? 0) - (a.context_window ?? 0);
          return ctxDiff !== 0 ? ctxDiff : (b.freebench_score ?? -1) - (a.freebench_score ?? -1);
        });
    case 'always-free':
      return models
        .map((m) => ({
          ...m,
          providers: m.providers.filter((p) => p.tier_type === 'always_free'),
        }))
        .filter((m) => m.providers.length > 0)
        .sort((a, b) => (b.freebench_score ?? -1) - (a.freebench_score ?? -1));
    case 'privacy':
      return models
        .map((m) => ({
          ...m,
          providers: m.providers.filter((p) => !p.trains_on_data),
        }))
        .filter((m) => m.providers.length > 0)
        .sort((a, b) => (b.freebench_score ?? -1) - (a.freebench_score ?? -1));
    case 'open-weights':
      return [...models]
        .filter((m) => m.is_open_weights === true)
        .sort((a, b) => (b.freebench_score ?? -1) - (a.freebench_score ?? -1));
    default:
      return [...models].sort((a, b) => (b.freebench_score ?? -1) - (a.freebench_score ?? -1));
  }
}
