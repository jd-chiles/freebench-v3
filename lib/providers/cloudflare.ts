import { z } from 'zod';
import { fetchJsonWithTimeout, fetchTextWithTimeout, formatErrorMessage } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const CLOUDFLARE_PUBLIC_MODELS_URL = 'https://developers.cloudflare.com/workers-ai/models/';
const CLOUDFLARE_NON_CHAT_REGEX = /\bguard\b|llama-guard|shieldgemma/i;

const CloudflarePropertySchema = z.object({
  property_id: z.string(),
  value: z.unknown().optional(),
});

const CloudflareModelSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  source: z.union([z.string(), z.number()]).optional(),
  task: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
  properties: z.array(CloudflarePropertySchema).optional(),
});

const CloudflareResponseSchema = z.object({
  success: z.boolean(),
  result: z.array(CloudflareModelSchema).default([]),
  result_info: z
    .object({
      page: z.number().optional(),
      per_page: z.number().optional(),
      total_count: z.number().optional(),
      total_pages: z.number().optional(),
    })
    .optional(),
});

type CloudflareModel = z.infer<typeof CloudflareModelSchema>;

function isHostedModel(model: CloudflareModel): boolean {
  if (typeof model.source === 'string') {
    return model.source === 'hosted' || model.name.startsWith('@cf/');
  }
  return model.name.startsWith('@cf/');
}

function isDeprecatedModel(model: CloudflareModel, nowMs: number): boolean {
  const props = model.properties ?? [];
  for (const prop of props) {
    if (
      prop.property_id === 'beta' &&
      typeof prop.value === 'string' &&
      prop.value.toLowerCase() === 'deprecated'
    ) {
      return true;
    }
    if (prop.property_id === 'planned_deprecation_date' && typeof prop.value === 'string' && prop.value) {
      const parsed = Date.parse(prop.value);
      if (!Number.isNaN(parsed) && parsed <= nowMs) {
        return true;
      }
    }
  }
  return false;
}

function extractPropertyNumber(model: CloudflareModel, propertyId: string): number | null {
  const found = model.properties?.find((p) => p.property_id === propertyId);
  if (!found || (typeof found.value !== 'string' && typeof found.value !== 'number')) return null;
  const parsed = Number(found.value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function extractPropertyBoolean(model: CloudflareModel, propertyId: string): boolean | null {
  const found = model.properties?.find((p) => p.property_id === propertyId);
  if (!found || found.value === null || found.value === undefined) return null;
  if (typeof found.value === 'boolean') return found.value;
  if (typeof found.value !== 'string') return null;
  const text = found.value.toLowerCase().trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

/**
 * Parses hosted `@cf/` Text Generation models from Cloudflare's public `workers-ai/models` HTML catalog.
 */
export function parseCloudflarePublicCatalogHtml(html: string): DiscoveredFreeModel[] {
  const config = getProvidersConfig().cloudflare;
  const seen = new Set<string>();
  const models: DiscoveredFreeModel[] = [];

  for (const cellMatch of html.matchAll(/<div\s+data-models-cell\b([^>]+)>/g)) {
    const attrBlob = cellMatch[1] ?? '';
    const attrs: Record<string, string> = {};
    for (const attrMatch of attrBlob.matchAll(/data-([a-z0-9-]+)(?:="([^"]*)")?/g)) {
      attrs[attrMatch[1]!] = attrMatch[2] ?? '';
    }

    const modelId = (attrs['model-id'] ?? '').trim();
    const task = (attrs['model-task'] ?? '').trim();
    const facetProviders = (attrs['facet-providers'] ?? '')
      .split('|')
      .map((s) => s.trim().toLowerCase());
    const tags = (attrs['model-tags'] ?? '').toLowerCase();

    if (task !== 'Text Generation') continue;
    if (!modelId.startsWith('@cf/')) continue;
    if (!facetProviders.includes('cloudflare-hosted')) continue;
    if (tags.includes('deprecated') || tags.includes('guardrails')) continue;
    if (CLOUDFLARE_NON_CHAT_REGEX.test(modelId)) continue;
    if (seen.has(modelId)) continue;
    seen.add(modelId);

    const capabilities = (attrs['facet-capabilities'] ?? '')
      .split('|')
      .map((s) => s.trim());
    const contextRaw = Number(attrs['model-context'] ?? '');
    const contextWindow =
      Number.isFinite(contextRaw) && contextRaw > 0 ? Math.round(contextRaw) : null;
    const zdrAvailable =
      (attrs['model-zdr'] ?? '').toLowerCase() === 'yes' ||
      capabilities.includes('Zero data retention');

    models.push({
      provider_slug: 'cloudflare',
      provider_model_id: modelId,
      raw_display_name: (attrs['model-label'] ?? '').trim() || modelId,
      context_window: contextWindow,
      supports_tools: capabilities.includes('Function calling') ? true : null,
      supports_vision:
        capabilities.includes('Vision') || /vision/i.test(modelId) ? true : null,
      rpm_limit: config.rpm_limit,
      rpd_limit: config.rpd_limit,
      tier_type: config.tier_type,
      trains_on_data: config.trains_on_data,
      requires_credit_card: config.requires_credit_card,
      signup_url: config.signup_url,
      zdr_available: zdrAvailable,
    });
  }

  return models;
}

/**
 * Polls Cloudflare Workers AI: uses authenticated `/ai/models/search` when credentials
 * are set, or falls back to the keyless public catalog at `developers.cloudflare.com/workers-ai/models/`.
 */
export async function pollCloudflare(): Promise<ProviderPollResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

  const startedAt = Date.now();
  const config = getProvidersConfig().cloudflare;

  try {
    if (!accountId || !apiToken) {
      const html = await fetchTextWithTimeout(CLOUDFLARE_PUBLIC_MODELS_URL);
      const models = parseCloudflarePublicCatalogHtml(html);
      return {
        provider_slug: 'cloudflare',
        ok: true,
        models,
        duration_ms: Date.now() - startedAt,
      };
    }

    const models: DiscoveredFreeModel[] = [];
    const nowMs = Date.now();
    let page = 1;
    let totalPages = 1;

    do {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        accountId
      )}/ai/models/search?task=Text%20Generation&per_page=100&page=${page}`;

      const raw = await fetchJsonWithTimeout<unknown>(url, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      const parsed = CloudflareResponseSchema.parse(raw);

      if (!parsed.success) {
        throw new Error('Cloudflare API returned success: false');
      }

      for (const item of parsed.result) {
        if (!isHostedModel(item)) {
          continue;
        }
        if (isDeprecatedModel(item, nowMs)) {
          continue;
        }
        if (CLOUDFLARE_NON_CHAT_REGEX.test(item.name)) {
          continue;
        }

        models.push({
          provider_slug: 'cloudflare',
          provider_model_id: item.name,
          raw_display_name: item.name,
          context_window: extractPropertyNumber(item, 'context_window'),
          supports_tools: extractPropertyBoolean(item, 'function_calling'),
          supports_vision: /vision/i.test(item.name) ? true : null,
          rpm_limit: config.rpm_limit,
          rpd_limit: config.rpd_limit,
          tier_type: config.tier_type,
          trains_on_data: config.trains_on_data,
          requires_credit_card: config.requires_credit_card,
          signup_url: config.signup_url,
        });
      }

      totalPages = parsed.result_info?.total_pages ?? 1;
      page += 1;
    } while (page <= totalPages && page <= 20);

    return {
      provider_slug: 'cloudflare',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'cloudflare',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
