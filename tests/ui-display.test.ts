import { describe, expect, it } from 'vitest';
import {
  extractBenchmarkSignals,
  getPrimaryLimitsSummary,
  getUnrankedReason,
  isLegacyOrTinyModel,
  isRankedModel,
  matchesLeaderboardScope,
} from '@/lib/leaderboard/display';
import {
  createDefaultFilters,
  DEFAULT_SORT_BY_CATEGORY,
  parseLeaderboardSearchParams,
  serializeLeaderboardSearchParams,
} from '@/lib/leaderboard/url-state';
import type { LeaderboardModel, ProviderOffering } from '@/lib/supabase/types';

function makeOffering(overrides: Partial<ProviderOffering> = {}): ProviderOffering {
  return {
    provider_slug: 'openrouter',
    provider_model_id: 'deepseek/deepseek-r1:free',
    raw_display_name: null,
    context_window: 128_000,
    supports_tools: true,
    supports_vision: false,
    rpm_limit: '20 RPM',
    rpd_limit: '200 RPD',
    rpm_int: 20,
    rpd_int: 200,
    tpm_int: null,
    tpd_int: null,
    tier_type: 'always_free',
    trains_on_data: false,
    requires_credit_card: false,
    signup_url: 'https://openrouter.ai',
    zdr_available: true,
    last_checked_at: '2026-11-25T00:00:00Z',
    ...overrides,
  };
}

function makeModel(overrides: Partial<LeaderboardModel> = {}): LeaderboardModel {
  return {
    canonical_id: 'deepseek-r1',
    display_name: 'DeepSeek R1',
    family: 'DeepSeek',
    parameter_count: '671B',
    context_window: 128_000,
    supports_tools: true,
    supports_vision: false,
    is_open_weights: true,
    eci_score: 132.8,
    livebench_global: 64.0,
    livebench_coding: 62.5,
    livebench_reasoning: 70.1,
    livebench_math: 68.4,
    livebench_if: null,
    livebench_data: null,
    bfcl_overall: 37.6,
    aider_polyglot: null,
    swebench_verified: null,
    freebench_score: 68.4,
    agentic_coding_score: 55.7,
    benchmark_coverage: 3,
    updated_at: '2026-11-25T00:00:00Z',
    active_provider_count: 1,
    providers: [makeOffering()],
    ...overrides,
  };
}

describe('leaderboard display helpers', () => {
  it('distinguishes ranked vs unranked models accurately', () => {
    const ranked = makeModel();
    const unranked = makeModel({
      freebench_score: null,
      benchmark_coverage: 0,
      eci_score: null,
      livebench_global: null,
      bfcl_overall: null,
    });

    expect(isRankedModel(ranked)).toBe(true);
    expect(isRankedModel(unranked)).toBe(false);
    expect(matchesLeaderboardScope(ranked, 'ranked')).toBe(true);
    expect(matchesLeaderboardScope(ranked, 'unranked')).toBe(false);
    expect(matchesLeaderboardScope(unranked, 'unranked')).toBe(true);
    expect(matchesLeaderboardScope(unranked, 'all')).toBe(true);
  });

  it('flags only unranked lora or <16K context models as legacy/tiny', () => {
    const legacyLora = makeModel({
      canonical_id: 'mistral-7b-instruct-v0.1-lora',
      display_name: 'Mistral 7B LoRA',
      freebench_score: null,
      benchmark_coverage: 0,
    });
    const tinyUnranked = makeModel({
      canonical_id: 'llama-3-8b',
      context_window: 8_192,
      freebench_score: null,
      benchmark_coverage: 0,
    });
    const frontierUnranked = makeModel({
      canonical_id: 'aurora-alpha',
      context_window: 256_000,
      freebench_score: null,
      benchmark_coverage: 0,
    });
    const rankedSmallContext = makeModel({
      context_window: 8_192,
      freebench_score: 42.0,
      benchmark_coverage: 1,
    });

    expect(isLegacyOrTinyModel(legacyLora)).toBe(true);
    expect(isLegacyOrTinyModel(tinyUnranked)).toBe(true);
    expect(isLegacyOrTinyModel(frontierUnranked)).toBe(false);
    expect(isLegacyOrTinyModel(rankedSmallContext)).toBe(false);
  });

  it('extracts only populated benchmark signals without null placeholders', () => {
    const sparse = makeModel({
      eci_score: 132.8,
      livebench_global: null,
      bfcl_overall: null,
      livebench_coding: 64.0,
      livebench_reasoning: null,
      livebench_math: null,
      swebench_verified: 41.2,
    });

    const signals = extractBenchmarkSignals(sparse, 4);
    expect(signals.map((s) => s.shortLabel)).toEqual(['ECI', 'SWE', 'Code']);
    expect(signals[0]?.formatted).toBe('132.8');

    const empty = makeModel({
      eci_score: null,
      livebench_global: null,
      bfcl_overall: null,
      livebench_coding: null,
      livebench_reasoning: null,
      livebench_math: null,
      swebench_verified: null,
      aider_polyglot: null,
    });
    expect(extractBenchmarkSignals(empty)).toEqual([]);
  });

  it('formats primary provider limits summary cleanly', () => {
    const offering = makeOffering({ rpm_int: 30, rpd_int: 14_400 });
    expect(getPrimaryLimitsSummary(offering)).toBe('30 RPM · 14.4K/d');

    const tokenDaily = makeOffering({
      provider_slug: 'nvidia',
      rpm_int: 10,
      rpd_int: null,
      tpd_int: 1_000_000,
      rpd_limit: '—',
    });
    expect(getPrimaryLimitsSummary(tokenDaily)).toBe('10 RPM · 1M tok/d');
  });

  it('classifies unranked models into Stealth/Preview, Legacy/Edge, or Awaiting Eval', () => {
    const stealth = makeModel({
      canonical_id: 'openrouter-hunter-alpha',
      display_name: 'Hunter Alpha',
      freebench_score: null,
      benchmark_coverage: 0,
      providers: [makeOffering({ provider_model_id: 'openrouter/hunter-alpha' })],
    });
    expect(getUnrankedReason(stealth).badge).toBe('Stealth / Preview');

    const awaiting = makeModel({
      canonical_id: 'new-frontier-70b',
      display_name: 'New Frontier 70B',
      context_window: 128_000,
      freebench_score: null,
      benchmark_coverage: 0,
    });
    expect(getUnrankedReason(awaiting).badge).toBe('Awaiting Eval');
  });

  it('round-trips scope and showLegacy URL parameters cleanly', () => {
    const defaults = {
      filters: createDefaultFilters('overall'),
      sortKey: DEFAULT_SORT_BY_CATEGORY.overall,
      sortAsc: false,
    };

    const parsed = parseLeaderboardSearchParams(
      new URLSearchParams('view=unranked&legacy=1'),
      defaults
    );
    expect(parsed.filters.scope).toBe('unranked');
    expect(parsed.filters.showLegacy).toBe(true);

    const qs = serializeLeaderboardSearchParams(
      parsed.filters,
      parsed.sortKey,
      parsed.sortAsc,
      defaults
    );
    expect(qs).toBe('view=unranked&legacy=1');
  });
});
