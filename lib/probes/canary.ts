import { formatErrorMessage } from '@/lib/providers/http';
import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';

export interface ProbeTarget {
  provider_slug: ProviderSlug;
  provider_model_id: string;
  last_probe_at: string | null;
}

export interface DiscoveredRateLimits {
  discovered_rpm: number | null;
  discovered_rpd: number | null;
  discovered_tpm: number | null;
}

export interface CanaryProbeResult {
  provider_slug: ProviderSlug;
  provider_model_id: string;
  ok: boolean;
  http_status: number | null;
  ttft_ms: number | null;
  tokens_per_sec: number | null;
  discovered_rpm: number | null;
  discovered_rpd: number | null;
  discovered_tpm: number | null;
  error_message: string | null;
  probed_at: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 12_000;

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().split(/[,;\s]/)[0] ?? '';
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
}

/**
 * Extracts standardized rate-limit header counts discovered during canary streaming probes.
 */
export function parseRateLimitHeaders(headers: Headers): DiscoveredRateLimits {
  const rpm =
    parsePositiveInt(headers.get('x-ratelimit-limit-requests')) ??
    parsePositiveInt(headers.get('ratelimit-limit'));
  const rpd = parsePositiveInt(headers.get('x-ratelimit-limit-requests-day'));
  const tpm =
    parsePositiveInt(headers.get('x-ratelimit-limit-tokens-minute')) ??
    parsePositiveInt(headers.get('x-ratelimit-limit-tokens'));

  return {
    discovered_rpm: rpm,
    discovered_rpd: rpd,
    discovered_tpm: tpm,
  };
}

function hasProbeCredentials(
  slug: ProviderSlug,
  env: Record<string, string | undefined>
): boolean {
  if (slug === 'pollinations') return true;
  const cfg = getProvidersConfig()[slug];
  if (!cfg) return false;
  if (slug === 'cloudflare') {
    return Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim() && env[cfg.env_var]?.trim());
  }
  return Boolean(env[cfg.env_var]?.trim());
}

/**
 * Selects up to `maxTargets` stalest eligible endpoints using round-robin interleaving
 * across providers that have credentials (or anonymous access).
 */
export function selectStalestProbeTargets(
  targets: ProbeTarget[],
  maxTargets: number = 18,
  env: Record<string, string | undefined> = process.env
): ProbeTarget[] {
  if (maxTargets <= 0) return [];

  const eligible = targets.filter((t) => hasProbeCredentials(t.provider_slug, env));
  if (eligible.length === 0) return [];

  const byProvider = new Map<ProviderSlug, ProbeTarget[]>();
  for (const target of eligible) {
    const bucket = byProvider.get(target.provider_slug) ?? [];
    bucket.push(target);
    byProvider.set(target.provider_slug, bucket);
  }

  for (const bucket of byProvider.values()) {
    bucket.sort((a, b) => {
      if (!a.last_probe_at && !b.last_probe_at) {
        return a.provider_model_id.localeCompare(b.provider_model_id);
      }
      if (!a.last_probe_at) return -1;
      if (!b.last_probe_at) return 1;
      return Date.parse(a.last_probe_at) - Date.parse(b.last_probe_at);
    });
  }

  const queues = [...byProvider.values()];
  const selected: ProbeTarget[] = [];

  while (selected.length < maxTargets) {
    let addedInPass = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (!next) continue;
      selected.push(next);
      addedInPass = true;
      if (selected.length >= maxTargets) break;
    }
    if (!addedInPass) break;
  }

  return selected;
}

/**
 * Computes 7-day uptime percentage (0-100) from probe boolean samples.
 */
export function compute7dUptimePct(samples: ReadonlyArray<{ ok: boolean }>): number | null {
  if (samples.length === 0) return null;
  const passed = samples.filter((s) => s.ok).length;
  return Math.round((passed / samples.length) * 10_000) / 100;
}

function buildProbeRequest(
  target: ProbeTarget,
  env: Record<string, string | undefined>
): { url: string; init: RequestInit } | null {
  const cfg = getProvidersConfig()[target.provider_slug];
  if (!cfg) return null;

  const apiKey = env[cfg.env_var]?.trim() ?? '';

  if (target.provider_slug === 'google') {
    if (!apiKey) return null;
    const modelPath = encodeURIComponent(target.provider_model_id);
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
        apiKey
      )}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      },
    };
  }

  if (target.provider_slug === 'cloudflare') {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!accountId || !apiKey) return null;
    return {
      url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        accountId
      )}/ai/run/${target.provider_model_id}`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 8,
          stream: true,
        }),
      },
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (target.provider_slug !== 'pollinations') {
    if (!apiKey) return null;
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (target.provider_slug === 'openrouter') {
    headers['HTTP-Referer'] = 'https://freebench.org';
    headers['X-Title'] = 'FreeBench';
  }

  return {
    url: `${cfg.api_base_url.replace(/\/$/, '')}/chat/completions`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: target.provider_model_id,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
        stream: true,
      }),
    },
  };
}

/**
 * Executes a zero-cost 8-token streaming canary probe against a single endpoint.
 * Measures TTFT, estimates throughput, parses rate-limit headers, and never throws.
 */
export async function probeEndpoint(
  target: ProbeTarget,
  env: Record<string, string | undefined> = process.env
): Promise<CanaryProbeResult> {
  const probedAt = new Date().toISOString();
  const req = buildProbeRequest(target, env);

  if (!req) {
    return {
      provider_slug: target.provider_slug,
      provider_model_id: target.provider_model_id,
      ok: false,
      http_status: null,
      ttft_ms: null,
      tokens_per_sec: null,
      discovered_rpm: null,
      discovered_rpd: null,
      discovered_tpm: null,
      error_message: 'Missing credentials for canary probe',
      probed_at: probedAt,
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(req.url, {
      ...req.init,
      signal: controller.signal,
    });
    const limits = parseRateLimitHeaders(response.headers);

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return {
        provider_slug: target.provider_slug,
        provider_model_id: target.provider_model_id,
        ok: false,
        http_status: response.status,
        ttft_ms: Date.now() - startedAt,
        tokens_per_sec: null,
        ...limits,
        error_message: `HTTP ${response.status} ${response.statusText}`.trim(),
        probed_at: probedAt,
      };
    }

    let firstChunkAt: number | null = null;
    let totalBytes = 0;

    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (firstChunkAt === null) {
            firstChunkAt = Date.now();
          }
          totalBytes += value?.byteLength ?? 0;
          if (totalBytes >= 4_096) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    const endedAt = Date.now();
    const ttftMs = Math.max(1, (firstChunkAt ?? endedAt) - startedAt);
    const streamDurationSec = Math.max(0.05, (endedAt - (firstChunkAt ?? startedAt)) / 1000);
    const estTokens = Math.max(1, Math.min(8, Math.round(totalBytes / 45)));
    const tokensPerSec =
      totalBytes > 0 ? Math.round((estTokens / streamDurationSec) * 10) / 10 : null;

    return {
      provider_slug: target.provider_slug,
      provider_model_id: target.provider_model_id,
      ok: true,
      http_status: response.status,
      ttft_ms: ttftMs,
      tokens_per_sec: tokensPerSec,
      ...limits,
      error_message: null,
      probed_at: probedAt,
    };
  } catch (error) {
    return {
      provider_slug: target.provider_slug,
      provider_model_id: target.provider_model_id,
      ok: false,
      http_status: null,
      ttft_ms: null,
      tokens_per_sec: null,
      discovered_rpm: null,
      discovered_rpd: null,
      discovered_tpm: null,
      error_message: formatErrorMessage(error),
      probed_at: probedAt,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Runs canary probes across targets with bounded concurrency.
 */
export async function runRotatingCanaryProbes(
  targets: ProbeTarget[],
  concurrency: number = 4,
  env: Record<string, string | undefined> = process.env
): Promise<CanaryProbeResult[]> {
  if (targets.length === 0) return [];
  const results: CanaryProbeResult[] = new Array(targets.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const idx = cursor;
      cursor += 1;
      const target = targets[idx];
      if (!target) continue;
      results[idx] = await probeEndpoint(target, env);
    }
  });

  await Promise.all(workers);
  return results;
}
