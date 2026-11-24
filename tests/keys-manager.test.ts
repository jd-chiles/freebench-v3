import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildKeyStatusRows,
  maskSecret,
  parseEnvFile,
  upsertEnvFileContent,
  validateProviderKeyLive,
} from '@/lib/keys/manager';
import { isAuthExpiredError, tagProviderError } from '@/lib/providers/http';

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API Key Storage, Status Matrix, Validation & Expiry Detection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('parses and upserts .env files while preserving comments and quotes', () => {
    const initial = [
      '# FreeBench local config',
      'FREEBENCH_OPS_EMAIL=jdchiles87@gmail.com',
      'GROQ_API_KEY="gsk_old_value"',
      "OTHER_QUOTED='single word'",
      '',
    ].join('\n');

    const parsed = parseEnvFile(initial);
    expect(parsed).toEqual({
      FREEBENCH_OPS_EMAIL: 'jdchiles87@gmail.com',
      GROQ_API_KEY: 'gsk_old_value',
      OTHER_QUOTED: 'single word',
    });

    const updated = upsertEnvFileContent(initial, {
      GROQ_API_KEY: 'gsk_new_value',
      MISTRAL_API_KEY: 'mistral_secret_key',
    });

    expect(updated).toContain('# FreeBench local config');
    expect(updated).toContain('FREEBENCH_OPS_EMAIL=jdchiles87@gmail.com');
    expect(updated).toContain('GROQ_API_KEY=gsk_new_value');
    expect(updated).toContain("OTHER_QUOTED='single word'");
    expect(updated).toContain('MISTRAL_API_KEY=mistral_secret_key');
    expect(updated.endsWith('\n')).toBe(true);
  });

  it('masks secrets safely for short and standard keys', () => {
    expect(maskSecret('short')).toBe('••••');
    expect(maskSecret('12345678')).toBe('••••');
    expect(maskSecret('gsk_1234567890abcd')).toBe('gsk_••••abcd');
  });

  it('builds 15-provider key status rows distinguishing keyless catalogs and multi-var providers', () => {
    const rows = buildKeyStatusRows(
      {
        GROQ_API_KEY: 'gsk_1234567890abcd',
        CLOUDFLARE_ACCOUNT_ID: 'acc_1234567890',
      },
      new Set(['GROQ_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'])
    );

    expect(rows).toHaveLength(15);

    const groq = rows.find((r) => r.slug === 'groq');
    expect(groq?.localPresent).toBe(true);
    expect(groq?.githubPresent).toBe(true);
    expect(groq?.maskedLocalValues.GROQ_API_KEY).toBe('gsk_••••abcd');

    // Cloudflare requires BOTH account ID and API token to count as locally present
    const cloudflare = rows.find((r) => r.slug === 'cloudflare');
    expect(cloudflare?.localPresent).toBe(false);
    expect(cloudflare?.githubPresent).toBe(true);

    const keylessProviders = rows
      .filter((r) => r.catalogMode === 'keyless')
      .map((r) => r.slug)
      .sort();
    expect(keylessProviders).toEqual([
      'kilo',
      'nvidia',
      'opencode',
      'openrouter',
      'pollinations',
      'sambanova',
    ]);
  });

  it('detects 401/403 auth failures and prefixes [KEY EXPIRED] idempotently', () => {
    expect(isAuthExpiredError('HTTP 401 Unauthorized: invalid key')).toBe(true);
    expect(isAuthExpiredError('HTTP 403 Forbidden')).toBe(true);
    expect(isAuthExpiredError('invalid_api_key provided')).toBe(true);
    expect(isAuthExpiredError('HTTP 500 Internal Server Error')).toBe(false);
    expect(isAuthExpiredError(null)).toBe(false);

    expect(tagProviderError('HTTP 401 Unauthorized')).toBe('[KEY EXPIRED] HTTP 401 Unauthorized');
    expect(tagProviderError('[KEY EXPIRED] HTTP 401 Unauthorized')).toBe(
      '[KEY EXPIRED] HTTP 401 Unauthorized'
    );
    expect(tagProviderError('HTTP 502 Bad Gateway')).toBe('HTTP 502 Bad Gateway');
  });

  it('validates provider keys live without leaking temporary process.env mutations', async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const auth = new Headers(init?.headers).get('Authorization');

        if (url.includes('api.groq.com')) {
          if (auth === 'Bearer gsk_valid_12345') {
            return jsonResponse({
              data: [{ id: 'llama-3.3-70b-versatile', active: true, context_window: 131072 }],
            });
          }
          return new Response('Invalid API key', { status: 401, statusText: 'Unauthorized' });
        }

        if (url.includes('openrouter.ai/api/v1/auth/key')) {
          return jsonResponse({ data: { label: 'freebench' } });
        }

        return new Response('Not found', { status: 404 });
      })
    );

    const okGroq = await validateProviderKeyLive('groq', { GROQ_API_KEY: 'gsk_valid_12345' });
    expect(okGroq.ok).toBe(true);
    expect(okGroq.modelCount).toBe(1);
    expect(okGroq.message).toContain('1 free model found');
    expect(process.env.GROQ_API_KEY).toBeUndefined();

    const badGroq = await validateProviderKeyLive('groq', { GROQ_API_KEY: 'gsk_bad' });
    expect(badGroq.ok).toBe(false);
    expect(badGroq.message).toContain('[KEY EXPIRED]');
    expect(process.env.GROQ_API_KEY).toBeUndefined();

    const okOr = await validateProviderKeyLive('openrouter', {
      OPENROUTER_API_KEY: 'sk-or-v1-test',
    });
    expect(okOr.ok).toBe(true);
    expect(okOr.message).toContain('/auth/key');
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
  });
});
