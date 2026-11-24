import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const OpenRouterModelSchema = z.object({
  id: z.string(),
  canonical_slug: z.string().optional(),
  name: z.string().optional(),
  context_length: z.number().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  pricing: z
    .object({
      prompt: z.union([z.string(), z.number()]).optional(),
      completion: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).optional(),
    })
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
});

const OpenRouterResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
});

function isZeroPrice(value: string | number | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'number') return value === 0;
  const trimmed = value.trim();
  if (trimmed === '-1' || trimmed === '') return false;
  return trimmed === '0' || Number(trimmed) === 0;
}

function isExpired(expirationDate: string | null | undefined, nowMs: number): boolean {
  if (!expirationDate) return false;
  const parsed = Date.parse(expirationDate);
  if (Number.isNaN(parsed)) return false;
  return parsed <= nowMs;
}

/**
 * Polls OpenRouter's public text-output model catalog (zero API keys required)
 * plus a best-effort ZDR lookup to tag Zero Data Retention free models.
 */
export async function pollOpenRouter(): Promise<ProviderPollResult> {
  const startedAt = Date.now();
  const config = getProvidersConfig().openrouter;

  try {
    const rawCatalog = await fetchJsonWithTimeout<unknown>('https://openrouter.ai/api/v1/models');
    const parsedCatalog = OpenRouterResponseSchema.parse(rawCatalog);

    let zdrModelIds = new Set<string>();
    try {
      const rawZdr = await fetchJsonWithTimeout<unknown>(
        'https://openrouter.ai/api/v1/models?zdr=true'
      );
      const parsedZdr = OpenRouterResponseSchema.parse(rawZdr);
      zdrModelIds = new Set(parsedZdr.data.map((m) => m.id));
    } catch {
      // ZDR lookup is optional enrichment; keep primary catalog results on failure.
      zdrModelIds = new Set<string>();
    }

    const nowMs = Date.now();
    const models: DiscoveredFreeModel[] = [];

    for (const item of parsedCatalog.data) {
      if (item.id === 'openrouter/free' || item.id === 'openrouter/auto') {
        continue;
      }
      if (!item.id.endsWith(':free')) {
        continue;
      }

      const promptPrice = item.pricing?.prompt;
      const completionPrice = item.pricing?.completion;
      if (promptPrice === '-1' || completionPrice === '-1') {
        continue;
      }
      if (!isZeroPrice(promptPrice) || !isZeroPrice(completionPrice)) {
        continue;
      }
      if (isExpired(item.expiration_date, nowMs)) {
        continue;
      }

      const hasZdr = zdrModelIds.has(item.id);
      const supportsTools = item.supported_parameters
        ? item.supported_parameters.includes('tools')
        : null;
      const supportsVision = item.architecture?.input_modalities
        ? item.architecture.input_modalities.includes('image')
        : null;

      models.push({
        provider_slug: 'openrouter',
        provider_model_id: item.id,
        raw_display_name: item.name ?? item.id,
        context_window: item.context_length ?? null,
        supports_tools: supportsTools,
        supports_vision: supportsVision,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: !hasZdr,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
        zdr_available: hasZdr,
      });
    }

    return {
      provider_slug: 'openrouter',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'openrouter',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
