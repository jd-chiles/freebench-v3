import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';

export type SortCategory =
  | 'overall'
  | 'agentic'
  | 'coding'
  | 'reasoning'
  | 'math'
  | 'tools';

export type SortKey =
  | 'freebench_score'
  | 'agentic_coding_score'
  | 'eci_score'
  | 'livebench_global'
  | 'livebench_coding'
  | 'livebench_reasoning'
  | 'livebench_math'
  | 'bfcl_overall'
  | 'aider_polyglot'
  | 'swebench_verified'
  | 'fb_eval_score'
  | 'context_window';

export interface LeaderboardFilterState {
  query: string;
  alwaysFreeOnly: boolean;
  directApiOnly: boolean;
  zeroTrainingOnly: boolean;
  toolsOnly: boolean;
  visionOnly: boolean;
  openWeightsOnly: boolean;
  myKeysOnly: boolean;
  minContext: number;
  selectedProviders: ProviderSlug[];
  category: SortCategory;
}

export const DEFAULT_SORT_BY_CATEGORY: Record<SortCategory, SortKey> = {
  overall: 'freebench_score',
  agentic: 'agentic_coding_score',
  coding: 'livebench_coding',
  reasoning: 'livebench_reasoning',
  math: 'livebench_math',
  tools: 'bfcl_overall',
};

const VALID_CATEGORIES = new Set<SortCategory>([
  'overall',
  'agentic',
  'coding',
  'reasoning',
  'math',
  'tools',
]);

const VALID_SORT_KEYS = new Set<SortKey>([
  'freebench_score',
  'agentic_coding_score',
  'eci_score',
  'livebench_global',
  'livebench_coding',
  'livebench_reasoning',
  'livebench_math',
  'bfcl_overall',
  'aider_polyglot',
  'swebench_verified',
  'fb_eval_score',
  'context_window',
]);

export function createDefaultFilters(
  initialCategory: SortCategory = 'overall',
  overrides?: Partial<LeaderboardFilterState>
): LeaderboardFilterState {
  return {
    query: '',
    alwaysFreeOnly: false,
    directApiOnly: false,
    zeroTrainingOnly: false,
    toolsOnly: false,
    visionOnly: false,
    openWeightsOnly: false,
    myKeysOnly: false,
    minContext: 0,
    selectedProviders: [],
    category: initialCategory,
    ...overrides,
  };
}

/**
 * Parses URL search parameters into validated leaderboard filter + sort state.
 */
export function parseLeaderboardSearchParams(
  params: URLSearchParams,
  defaults: { filters: LeaderboardFilterState; sortKey: SortKey; sortAsc: boolean }
): { filters: LeaderboardFilterState; sortKey: SortKey; sortAsc: boolean } {
  const validProviders = new Set(Object.keys(getProvidersConfig()));
  const rawCat = params.get('cat') as SortCategory | null;
  const category = rawCat && VALID_CATEGORIES.has(rawCat) ? rawCat : defaults.filters.category;

  const rawSort = params.get('sort') as SortKey | null;
  const sortKey =
    rawSort && VALID_SORT_KEYS.has(rawSort)
      ? rawSort
      : rawCat && VALID_CATEGORIES.has(rawCat)
        ? DEFAULT_SORT_BY_CATEGORY[category]
        : defaults.sortKey;

  const rawDir = params.get('dir');
  const sortAsc = rawDir === 'asc' ? true : rawDir === 'desc' ? false : defaults.sortAsc;

  const rawProviders = params.get('providers');
  const selectedProviders = rawProviders
    ? (rawProviders
        .split(',')
        .map((s) => s.trim())
        .filter((s) => validProviders.has(s)) as ProviderSlug[])
    : defaults.filters.selectedProviders;

  const rawCtx = params.get('ctx');
  const parsedCtx = rawCtx !== null ? Number(rawCtx) : defaults.filters.minContext;

  return {
    filters: {
      query: params.get('q') ?? defaults.filters.query,
      alwaysFreeOnly:
        params.has('free') ? params.get('free') === '1' : defaults.filters.alwaysFreeOnly,
      directApiOnly:
        params.has('api') ? params.get('api') === '1' : defaults.filters.directApiOnly,
      zeroTrainingOnly:
        params.has('zdr') ? params.get('zdr') === '1' : defaults.filters.zeroTrainingOnly,
      toolsOnly: params.has('tools') ? params.get('tools') === '1' : defaults.filters.toolsOnly,
      visionOnly: params.has('vision') ? params.get('vision') === '1' : defaults.filters.visionOnly,
      openWeightsOnly:
        params.has('open') ? params.get('open') === '1' : defaults.filters.openWeightsOnly,
      myKeysOnly: params.has('mykeys') ? params.get('mykeys') === '1' : defaults.filters.myKeysOnly,
      minContext: Number.isFinite(parsedCtx) && parsedCtx >= 0 ? parsedCtx : 0,
      selectedProviders,
      category,
    },
    sortKey,
    sortAsc,
  };
}

/**
 * Serializes non-default filter + sort state into clean shareable URL query parameters.
 */
export function serializeLeaderboardSearchParams(
  filters: LeaderboardFilterState,
  sortKey: SortKey,
  sortAsc: boolean,
  defaults: { filters: LeaderboardFilterState; sortKey: SortKey }
): string {
  const params = new URLSearchParams();

  if (filters.query.trim()) params.set('q', filters.query.trim());
  if (filters.category !== defaults.filters.category) params.set('cat', filters.category);
  if (sortKey !== DEFAULT_SORT_BY_CATEGORY[filters.category]) {
    params.set('sort', sortKey);
  } else if (sortKey !== defaults.sortKey && filters.category === defaults.filters.category) {
    params.set('sort', sortKey);
  }
  if (sortAsc) params.set('dir', 'asc');
  if (filters.alwaysFreeOnly) params.set('free', '1');
  if (filters.directApiOnly) params.set('api', '1');
  if (filters.zeroTrainingOnly) params.set('zdr', '1');
  if (filters.toolsOnly) params.set('tools', '1');
  if (filters.visionOnly) params.set('vision', '1');
  if (filters.openWeightsOnly) params.set('open', '1');
  if (filters.myKeysOnly) params.set('mykeys', '1');
  if (filters.minContext > 0) params.set('ctx', String(filters.minContext));
  if (filters.selectedProviders.length > 0) {
    params.set('providers', filters.selectedProviders.join(','));
  }

  return params.toString();
}
