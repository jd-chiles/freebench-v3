import { describe, expect, it } from 'vitest';
import seedSnapshotRaw from '@/data/seed-snapshot.json';
import {
  createDefaultFilters,
  DEFAULT_SORT_BY_CATEGORY,
  parseLeaderboardSearchParams,
  serializeLeaderboardSearchParams,
} from '@/lib/leaderboard/url-state';
import {
  computeSessionViability,
  dedupeDiscoveredModelsByCanonicalId,
  getNextResetCountdown,
  resolveEffectiveLimits,
  sortProviderOfferings,
} from '@/lib/providers/limits';
import { getModelById } from '@/lib/data/queries';
import { getSiteUrl } from '@/lib/site';
import { buildFallbackStack } from '@/lib/snippets/stack-generator';
import type { LeaderboardModel, ProviderOffering } from '@/lib/supabase/types';

function makeOffering(overrides: Partial<ProviderOffering>): ProviderOffering {
  return {
    provider_slug: 'groq',
    provider_model_id: 'llama-3.3-70b-versatile',
    raw_display_name: null,
    context_window: 131072,
    supports_tools: true,
    supports_vision: false,
    rpm_limit: '30 RPM',
    rpd_limit: '1,000 RPD',
    tier_type: 'always_free',
    trains_on_data: false,
    requires_credit_card: false,
    signup_url: 'https://console.groq.com/keys',
    zdr_available: false,
    last_checked_at: '2026-11-24T00:00:00Z',
    ...overrides,
  };
}

describe('Wave 2 Limits, URL State & Stack Builder', () => {
  it('resolves model-level overrides for Google and Groq', () => {
    const googlePro = resolveEffectiveLimits(
      makeOffering({ provider_slug: 'google', provider_model_id: 'gemini-2.5-pro' })
    );
    expect(googlePro.rpmInt).toBe(5);
    expect(googlePro.rpdInt).toBe(100);
    expect(googlePro.tpmInt).toBe(250_000);
    expect(googlePro.quotaResetTz).toBe('America/Los_Angeles');

    const groqQwen = resolveEffectiveLimits(
      makeOffering({ provider_slug: 'groq', provider_model_id: 'qwen/qwen3-32b' })
    );
    expect(groqQwen.tpmInt).toBe(6_000);
    expect(groqQwen.tpdInt).toBe(500_000);
  });

  it('classifies agent session viability across full_agent, short_tasks, and one_shot', () => {
    const full = computeSessionViability(
      makeOffering({ provider_slug: 'google', provider_model_id: 'gemini-2.5-flash', trains_on_data: true })
    );
    expect(full.level).toBe('full_agent');

    const shortCredit = computeSessionViability(
      makeOffering({
        provider_slug: 'cerebras',
        provider_model_id: 'llama-3.3-70b',
        tier_type: 'trial_credit',
      })
    );
    expect(shortCredit.level).toBe('short_tasks');

    const openrouterCap = computeSessionViability(
      makeOffering({ provider_slug: 'openrouter', provider_model_id: 'deepseek/deepseek-r1:free' })
    );
    expect(openrouterCap.level).toBe('one_shot');

    const groqTightTpm = computeSessionViability(
      makeOffering({ provider_slug: 'groq', provider_model_id: 'qwen/qwen3-32b' })
    );
    expect(groqTightTpm.level).toBe('one_shot');
  });

  it('computes deterministic reset countdowns from timezone and fixed Date', () => {
    // 2026-11-24T22:15:00Z -> 1h 45m until 00:00 UTC
    const countdown = getNextResetCountdown('UTC', new Date('2026-11-24T22:15:00Z'));
    expect(countdown).toBe('Resets in 1h 45m');
    expect(getNextResetCountdown(null)).toBeNull();
  });

  it('sorts offerings deterministically (always_free + no-train first, trial_credit last)', () => {
    const sorted = sortProviderOfferings([
      makeOffering({ provider_slug: 'cerebras', tier_type: 'trial_credit', trains_on_data: false }),
      makeOffering({ provider_slug: 'google', provider_model_id: 'gemini-2.5-flash', trains_on_data: true }),
      makeOffering({ provider_slug: 'sambanova', provider_model_id: 'DeepSeek-R1', trains_on_data: false }),
    ]);

    expect(sorted.map((o) => o.provider_slug)).toEqual(['sambanova', 'google', 'cerebras']);

    const dedupedUi = sortProviderOfferings([
      makeOffering({ provider_slug: 'mistral', provider_model_id: 'mistral-medium', trains_on_data: true }),
      makeOffering({ provider_slug: 'mistral', provider_model_id: 'mistral-medium-3', trains_on_data: true }),
    ]);
    expect(dedupedUi).toHaveLength(1);
    expect(dedupedUi[0]?.provider_model_id).toBe('mistral-medium');
  });

  it('deduplicates discovered provider offerings by canonical ID', () => {
    const deduped = dedupeDiscoveredModelsByCanonicalId([
      {
        provider_slug: 'mistral',
        provider_model_id: 'mistral-medium',
        raw_display_name: 'mistral-medium',
        context_window: 262144,
        supports_tools: true,
        supports_vision: false,
        rpm_limit: '1 RPS',
        rpd_limit: 'Free',
        tier_type: 'always_free',
        trains_on_data: true,
        requires_credit_card: false,
        signup_url: 'https://console.mistral.ai/',
      },
      {
        provider_slug: 'mistral',
        provider_model_id: 'mistral-medium-3',
        raw_display_name: 'mistral-medium-3',
        context_window: 262144,
        supports_tools: true,
        supports_vision: false,
        rpm_limit: '1 RPS',
        rpd_limit: 'Free',
        tier_type: 'always_free',
        trains_on_data: true,
        requires_credit_card: false,
        signup_url: 'https://console.mistral.ai/',
      },
      {
        provider_slug: 'google',
        provider_model_id: 'gemini-3.1-flash-lite-preview',
        raw_display_name: 'Gemini 3.1 Flash-Lite Preview',
        context_window: 1048576,
        supports_tools: true,
        supports_vision: true,
        rpm_limit: '15 RPM',
        rpd_limit: '1,000 RPD',
        tier_type: 'always_free',
        trains_on_data: true,
        requires_credit_card: false,
        signup_url: 'https://aistudio.google.com/',
      },
      {
        provider_slug: 'google',
        provider_model_id: 'gemini-3.1-flash-lite',
        raw_display_name: 'Gemini 3.1 Flash-Lite',
        context_window: 1048576,
        supports_tools: true,
        supports_vision: true,
        rpm_limit: '15 RPM',
        rpd_limit: '1,000 RPD',
        tier_type: 'always_free',
        trains_on_data: true,
        requires_credit_card: false,
        signup_url: 'https://aistudio.google.com/',
      },
    ]);

    expect(deduped.map((d) => `${d.norm.canonicalId}:${d.model.provider_model_id}`).sort()).toEqual([
      'gemini-3.1-flash-lite:gemini-3.1-flash-lite',
      'mistral-medium-3:mistral-medium-3',
    ]);
  });

  it('round-trips leaderboard URL search params cleanly', () => {
    const defaults = {
      filters: createDefaultFilters('overall'),
      sortKey: DEFAULT_SORT_BY_CATEGORY.overall,
      sortAsc: false,
    };

    const parsed = parseLeaderboardSearchParams(
      new URLSearchParams(
        'q=deepseek&cat=agentic&free=1&api=1&zdr=1&mykeys=1&ctx=128000&providers=openrouter,groq&dir=asc'
      ),
      defaults
    );

    expect(parsed.filters).toMatchObject({
      query: 'deepseek',
      category: 'agentic',
      alwaysFreeOnly: true,
      directApiOnly: true,
      zeroTrainingOnly: true,
      myKeysOnly: true,
      minContext: 128_000,
      selectedProviders: ['openrouter', 'groq'],
    });
    expect(parsed.sortKey).toBe('agentic_coding_score');
    expect(parsed.sortAsc).toBe(true);

    const serialized = serializeLeaderboardSearchParams(
      parsed.filters,
      parsed.sortKey,
      parsed.sortAsc,
      defaults
    );
    const reparsed = parseLeaderboardSearchParams(new URLSearchParams(serialized), defaults);
    expect(reparsed).toEqual(parsed);
  });

  it('builds valid LiteLLM & OpenCode fallback stacks enforcing alwaysFreeOnly and zeroTrainingOnly', () => {
    const models = (seedSnapshotRaw as { models: LeaderboardModel[] }).models;
    const stack = buildFallbackStack(models, {
      ownedProviders: ['openrouter', 'kilo', 'google', 'cerebras', 'groq'],
      task: 'agentic',
      alwaysFreeOnly: true,
      zeroTrainingOnly: true,
      minContext: 32_768,
      maxRoutes: 4,
    });

    expect(stack.routes.length).toBeGreaterThan(0);
    for (const route of stack.routes) {
      expect(route.offering.tier_type).toBe('always_free');
      expect(route.offering.trains_on_data).toBe(false);
    }

    const litellm = stack.configs.find((c) => c.id === 'litellm')?.code ?? '';
    expect(litellm).toContain('cooldown_time: 60');

    const opencode = stack.configs.find((c) => c.id === 'opencode')?.code ?? '';
    const parsedJson = JSON.parse(opencode) as { model?: string; small_model?: string };
    expect(parsedJson.model).toBeTruthy();
  });

  it('resolves canonical site URL with fallback and handles malformed model IDs safely', async () => {
    expect(getSiteUrl({})).toBe('https://freebench.org');
    expect(getSiteUrl({ SITE_URL: 'https://freebench-v3.vercel.app/' })).toBe(
      'https://freebench-v3.vercel.app'
    );
    expect(getSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'freebench.org' })).toBe(
      'https://freebench.org'
    );
    expect(getSiteUrl({ SITE_URL: 'not a valid url://' })).toBe('https://freebench.org');

    const malformed = await getModelById('%E0%A4%A');
    expect(malformed.model).toBeNull();
  });
});
