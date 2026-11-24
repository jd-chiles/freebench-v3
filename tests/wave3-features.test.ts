import { describe, expect, it } from 'vitest';
import seedSnapshotRaw from '@/data/seed-snapshot.json';
import { filterApiModels, selectBestRoute } from '@/lib/api/router';
import { handleMcpRequest } from '@/lib/mcp/server';
import { estimateAgent100TurnCostUsd, getPaidEscapeHatch } from '@/lib/pricing/escape-hatch';
import {
  compute7dUptimePct,
  parseRateLimitHeaders,
  selectStalestProbeTargets,
} from '@/lib/probes/canary';
import { analyzePinnedStackStatus } from '@/lib/providers/my-stack';
import { getProvidersConfig } from '@/lib/providers/types';
import type { LeaderboardModel } from '@/lib/supabase/types';

describe('Wave 3 Canary Probes, Router API, MCP, Stack Pins & Escape Hatch', () => {
  const models = (seedSnapshotRaw as { models: LeaderboardModel[] }).models;

  it('parses rate limit headers, selects stalest targets round-robin, and computes uptime', () => {
    const headers = new Headers({
      'x-ratelimit-limit-requests': '30',
      'x-ratelimit-limit-requests-day': '1000',
      'x-ratelimit-limit-tokens-minute': '12000',
    });
    expect(parseRateLimitHeaders(headers)).toEqual({
      discovered_rpm: 30,
      discovered_rpd: 1000,
      discovered_tpm: 12000,
    });

    const selected = selectStalestProbeTargets(
      [
        { provider_slug: 'pollinations', provider_model_id: 'openai-fast', last_probe_at: '2026-11-24T01:00:00Z' },
        { provider_slug: 'pollinations', provider_model_id: 'openai-large', last_probe_at: null },
        { provider_slug: 'groq', provider_model_id: 'llama-3.3-70b-versatile', last_probe_at: null },
        { provider_slug: 'google', provider_model_id: 'gemini-2.5-flash', last_probe_at: null },
      ],
      4,
      { GROQ_API_KEY: 'test-key' }
    );

    // Google has no key so excluded; Pollinations & Groq round-robined with nulls first
    expect(selected.map((t) => `${t.provider_slug}:${t.provider_model_id}`)).toEqual([
      'pollinations:openai-large',
      'groq:llama-3.3-70b-versatile',
      'pollinations:openai-fast',
    ]);

    expect(compute7dUptimePct([{ ok: true }, { ok: true }, { ok: false }, { ok: true }])).toBe(75);
    expect(compute7dUptimePct([])).toBeNull();
  });

  it('filters /api/v1/models and selects distinct-provider fallbacks in /api/v1/route', () => {
    const filtered = filterApiModels(
      models,
      new URLSearchParams('task=agentic-coding&always_free=1&zero_training=1&limit=5')
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThanOrEqual(5);
    for (const model of filtered) {
      expect(model.supports_tools).not.toBe(false);
      for (const p of model.providers) {
        expect(p.tier_type).toBe('always_free');
        expect(p.trains_on_data).toBe(false);
      }
    }

    const route = selectBestRoute(
      models,
      new URLSearchParams('task=agentic-coding&always_free=1&direct_api=1&zero_training=1')
    );
    expect(route.recommended).not.toBeNull();
    expect(route.recommended?.trains_on_data).toBe(false);
    expect(route.recommended?.tier_type).toBe('always_free');
    expect(route.recommended?.access_mode).toBe('direct_api');
    expect(route.fallbacks.length).toBeGreaterThan(0);

    const cfg = getProvidersConfig();
    expect(cfg.kilo.access_mode).toBe('harness_only');
    expect(cfg.opencode.access_mode).toBe('harness_only');
    expect(cfg.openrouter.access_mode).toBe('direct_api');
    expect(cfg.groq.access_mode).toBe('direct_api');

    const directFiltered = filterApiModels(models, new URLSearchParams('direct_api=1'));
    for (const m of directFiltered) {
      for (const p of m.providers) {
        expect(cfg[p.provider_slug].access_mode).toBe('direct_api');
      }
    }
  });

  it('handles MCP JSON-RPC initialize, tools/list, and tools/call', () => {
    const initRes = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, models) as {
      result: { serverInfo: { name: string } };
    };
    expect(initRes.result.serverInfo.name).toBe('freebench-mcp');

    const listRes = handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, models) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listRes.result.tools.map((t) => t.name)).toEqual([
      'get_best_free_model',
      'get_free_fallback_stack',
    ]);

    const callRes = handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_best_free_model',
          arguments: { task: 'agentic-coding', always_free: true, zero_training: true },
        },
      },
      models
    ) as { result: { content: Array<{ text: string }> } };
    const parsedPayload = JSON.parse(callRes.result.content[0]!.text) as {
      recommended: { canonical_id: string };
    };
    expect(parsedPayload.recommended.canonical_id).toBeTruthy();
  });

  it('detects dropped, overtaken, and healthy pinned stack alerts', () => {
    const alwaysFreeSorted = [...models]
      .filter((m) => m.freebench_score !== null && m.providers.some((p) => p.tier_type === 'always_free'))
      .sort((a, b) => (b.freebench_score ?? -1) - (a.freebench_score ?? -1));
    const topLive = alwaysFreeSorted[0]!;
    const weakModel = [...alwaysFreeSorted]
      .filter((m) => topLive.freebench_score! - m.freebench_score! >= 5)
      .pop()!;

    const alerts = analyzePinnedStackStatus(
      [
        { canonicalId: topLive.canonical_id, displayName: topLive.display_name, pinnedScore: topLive.freebench_score, pinnedAt: '2026-11-24T00:00:00Z' },
        { canonicalId: weakModel.canonical_id, displayName: weakModel.display_name, pinnedScore: weakModel.freebench_score, pinnedAt: '2026-11-24T00:00:00Z' },
        { canonicalId: 'retired-model-xyz', displayName: 'Retired XYZ', pinnedScore: 70, pinnedAt: '2026-11-24T00:00:00Z' },
      ],
      models,
      []
    );

    expect(alerts[0]?.status).toBe('healthy');
    expect(alerts[1]?.status).toBe('overtaken');
    expect(alerts[1]?.replacement).not.toBeNull();
    expect(alerts[2]?.status).toBe('dropped');
    expect(alerts[2]?.replacement).not.toBeNull();
  });

  it('computes honest paid escape-hatch pricing and 100-turn cost estimates', () => {
    const deepseek = getPaidEscapeHatch('deepseek-r1');
    expect(deepseek.length).toBeGreaterThan(0);
    expect(deepseek[0]?.provider).toBe('DeepSeek Direct');
    // 0.55 * 0.5 + 2.19 * 0.05 = 0.275 + 0.1095 = 0.3845 -> 0.385
    expect(estimateAgent100TurnCostUsd(deepseek[0]!)).toBe(0.385);
  });

  it('falls back gracefully in selectBestRoute when task subscores are unpopulated', () => {
    const unpopulatedModels: LeaderboardModel[] = models.slice(0, 3).map((m, idx) => ({
      ...m,
      agentic_coding_score: null,
      livebench_coding: null,
      livebench_reasoning: null,
      livebench_math: null,
      bfcl_overall: null,
      supports_tools: idx === 0 ? false : true,
      freebench_score: idx === 1 ? 65 : idx === 2 ? 60 : 80,
      context_window: idx === 1 ? 65536 : 131072,
    }));

    const route = selectBestRoute(
      unpopulatedModels,
      new URLSearchParams('task=agentic-coding&always_free=1&direct_api=1')
    );

    expect(route.recommended).not.toBeNull();
    expect(route.recommended?.tier_type).toBe('always_free');
    expect(route.recommended?.access_mode).toBe('direct_api');
    expect(route.recommended?.canonical_id).toBe(unpopulatedModels[1]?.canonical_id);
    expect(route.fallbacks.every((f) => f.access_mode === 'direct_api' && f.tier_type === 'always_free')).toBe(
      true
    );
  });
});
