import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const CloudflarePropertySchema = z.object({
  property_id: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
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
    if (prop.property_id === 'beta' && String(prop.value).toLowerCase() === 'deprecated') {
      return true;
    }
    if (prop.property_id === 'planned_deprecation_date' && prop.value) {
      const parsed = Date.parse(String(prop.value));
      if (!Number.isNaN(parsed) && parsed <= nowMs) {
        return true;
      }
    }
  }
  return false;
}

function extractPropertyNumber(model: CloudflareModel, propertyId: string): number | null {
  const found = model.properties?.find((p) => p.property_id === propertyId);
  if (!found || found.value === null || found.value === undefined) return null;
  const parsed = Number(found.value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function extractPropertyBoolean(model: CloudflareModel, propertyId: string): boolean | null {
  const found = model.properties?.find((p) => p.property_id === propertyId);
  if (!found || found.value === null || found.value === undefined) return null;
  if (typeof found.value === 'boolean') return found.value;
  const text = String(found.value).toLowerCase().trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

/**
 * Polls Cloudflare Workers AI `/ai/models/search` (never `/ai/v1/models`),
 * strictly filtering to hosted `@cf/` models with free Neuron allocation.
 */
export async function pollCloudflare(): Promise<ProviderPollResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

  if (!accountId) {
    return missingEnvResult('cloudflare', 'CLOUDFLARE_ACCOUNT_ID');
  }
  if (!apiToken) {
    return missingEnvResult('cloudflare', 'CLOUDFLARE_API_TOKEN');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().cloudflare;

  try {
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
