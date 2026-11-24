import { pollProviderBySlug } from '@/lib/providers';
import { fetchJsonWithTimeout, formatErrorMessage, tagProviderError } from '@/lib/providers/http';
import { getProvidersConfig, type ProviderSlug } from '@/lib/providers/types';

export type KeyTier = 1 | 2 | 3;
export type CatalogAuthMode = 'keyless' | 'keyed';

export interface ProviderKeySpec {
  slug: ProviderSlug;
  tier: KeyTier;
  envVars: readonly string[];
  catalogMode: CatalogAuthMode;
  note?: string;
}

export interface KeyStatusRow {
  slug: ProviderSlug;
  displayName: string;
  tier: KeyTier | 0;
  catalogMode: CatalogAuthMode;
  envVars: readonly string[];
  localPresent: boolean;
  githubPresent: boolean;
  maskedLocalValues: Record<string, string>;
  signupUrl: string;
  note?: string;
}

export interface KeyValidationResult {
  ok: boolean;
  modelCount: number;
  message: string;
}

/**
 * Providers whose public catalog endpoints can be polled without an API key.
 */
export const KEYLESS_CATALOG_PROVIDERS: ReadonlySet<ProviderSlug> = new Set([
  'openrouter',
  'kilo',
  'opencode',
  'pollinations',
  'nvidia',
  'sambanova',
]);

/**
 * Ordered list of provider credentials sorted by free-model ROI (Tier 1 -> Tier 3).
 */
export const PROVIDER_KEY_SPECS: ReadonlyArray<ProviderKeySpec> = [
  { slug: 'groq', tier: 1, envVars: ['GROQ_API_KEY'], catalogMode: 'keyed' },
  { slug: 'google', tier: 1, envVars: ['GOOGLE_AI_API_KEY'], catalogMode: 'keyed' },
  { slug: 'mistral', tier: 1, envVars: ['MISTRAL_API_KEY'], catalogMode: 'keyed' },
  {
    slug: 'cloudflare',
    tier: 1,
    envVars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    catalogMode: 'keyed',
    note: 'Requires both Cloudflare Account ID and Workers AI API Token',
  },
  { slug: 'cohere', tier: 2, envVars: ['COHERE_API_KEY'], catalogMode: 'keyed' },
  { slug: 'chutes', tier: 2, envVars: ['CHUTES_API_KEY'], catalogMode: 'keyed' },
  { slug: 'siliconflow', tier: 2, envVars: ['SILICONFLOW_API_KEY'], catalogMode: 'keyed' },
  { slug: 'zai', tier: 2, envVars: ['ZAI_API_KEY'], catalogMode: 'keyed' },
  { slug: 'cerebras', tier: 3, envVars: ['CEREBRAS_API_KEY'], catalogMode: 'keyed' },
  {
    slug: 'sambanova',
    tier: 3,
    envVars: ['SAMBANOVA_API_KEY'],
    catalogMode: 'keyless',
    note: 'Catalog is keyless; key enables canary probes',
  },
  {
    slug: 'nvidia',
    tier: 3,
    envVars: ['NVIDIA_API_KEY'],
    catalogMode: 'keyless',
    note: 'Catalog is keyless; key enables canary probes',
  },
  {
    slug: 'openrouter',
    tier: 3,
    envVars: ['OPENROUTER_API_KEY'],
    catalogMode: 'keyless',
    note: 'Catalog is keyless; key enables canary probes',
  },
];

/**
 * Parses a `.env` file into key/value pairs, ignoring blank lines and `#` comments.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

function formatEnvValue(value: string): string {
  const needsQuotes = /[\s#"'`]/.test(value);
  if (!needsQuotes) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Updates existing `KEY=` lines in place or appends missing keys while preserving comments.
 */
export function upsertEnvFileContent(
  existingContent: string,
  updates: Record<string, string>
): string {
  const normalizedUpdates = new Map<string, string>();
  for (const [key, val] of Object.entries(updates)) {
    const trimmedKey = key.trim();
    const trimmedVal = val.trim();
    if (trimmedKey && trimmedVal) {
      normalizedUpdates.set(trimmedKey, trimmedVal);
    }
  }

  if (normalizedUpdates.size === 0) {
    return existingContent;
  }

  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const seenKeys = new Set<string>();
  const updatedLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) {
      return line;
    }
    const key = match[1]!;
    const nextVal = normalizedUpdates.get(key);
    if (nextVal === undefined) {
      return line;
    }
    seenKeys.add(key);
    return `${key}=${formatEnvValue(nextVal)}`;
  });

  for (const [key, val] of normalizedUpdates.entries()) {
    if (!seenKeys.has(key)) {
      updatedLines.push(`${key}=${formatEnvValue(val)}`);
    }
  }

  return `${updatedLines.join('\n')}\n`;
}

/**
 * Redacts a secret string for safe terminal previews (never logs full credentials).
 */
export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return '••••';
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

/**
 * Builds the 15-provider credential & keyless catalog matrix for `npm run keys:status`.
 */
export function buildKeyStatusRows(
  localEnv: Record<string, string>,
  ghSecretNames: ReadonlySet<string>
): KeyStatusRow[] {
  const providersConfig = getProvidersConfig();
  const rows: KeyStatusRow[] = [];
  const handledSlugs = new Set<ProviderSlug>();

  for (const spec of PROVIDER_KEY_SPECS) {
    handledSlugs.add(spec.slug);
    const cfg = providersConfig[spec.slug];
    const maskedLocalValues: Record<string, string> = {};

    let localPresent = true;
    let githubPresent = true;
    for (const envVar of spec.envVars) {
      const localVal = localEnv[envVar]?.trim() ?? '';
      if (!localVal) {
        localPresent = false;
      } else {
        maskedLocalValues[envVar] = maskSecret(localVal);
      }
      if (!ghSecretNames.has(envVar)) {
        githubPresent = false;
      }
    }

    rows.push({
      slug: spec.slug,
      displayName: cfg.display_name,
      tier: spec.tier,
      catalogMode: spec.catalogMode,
      envVars: spec.envVars,
      localPresent,
      githubPresent,
      maskedLocalValues,
      signupUrl: cfg.signup_url,
      note: spec.note,
    });
  }

  const allSlugs = Object.keys(providersConfig) as ProviderSlug[];
  for (const slug of allSlugs) {
    if (handledSlugs.has(slug)) continue;
    const cfg = providersConfig[slug];
    rows.push({
      slug,
      displayName: cfg.display_name,
      tier: 0,
      catalogMode: KEYLESS_CATALOG_PROVIDERS.has(slug) ? 'keyless' : 'keyed',
      envVars: [],
      localPresent: true,
      githubPresent: true,
      maskedLocalValues: {},
      signupUrl: cfg.signup_url,
      note: 'Public keyless catalog (no API key required)',
    });
  }

  return rows;
}

/**
 * Temporarily applies candidate credentials in memory and validates them live against the provider API.
 */
export async function validateProviderKeyLive(
  slug: ProviderSlug,
  envOverrides: Record<string, string>
): Promise<KeyValidationResult> {
  const previousEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envOverrides)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    if (slug === 'openrouter') {
      const apiKey = (envOverrides.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '').trim();
      if (!apiKey) {
        return { ok: false, modelCount: 0, message: 'Missing OPENROUTER_API_KEY' };
      }

      try {
        await fetchJsonWithTimeout<unknown>('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return {
          ok: true,
          modelCount: 0,
          message: 'OpenRouter API key verified (/auth/key)',
        };
      } catch (error) {
        return {
          ok: false,
          modelCount: 0,
          message: tagProviderError(formatErrorMessage(error)),
        };
      }
    }

    const res = await pollProviderBySlug(slug);
    if (res.ok && res.models.length > 0) {
      return {
        ok: true,
        modelCount: res.models.length,
        message: `Valid — ${res.models.length} free model${res.models.length === 1 ? '' : 's'} found`,
      };
    }

    if (res.ok) {
      return {
        ok: false,
        modelCount: 0,
        message: 'Authenticated, but 0 free models returned',
      };
    }

    return {
      ok: false,
      modelCount: 0,
      message: tagProviderError(res.error ?? 'Validation failed'),
    };
  } finally {
    for (const [key, prevValue] of previousEnv.entries()) {
      if (prevValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prevValue;
      }
    }
  }
}
