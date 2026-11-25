import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const KiloModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().int().nonnegative().nullable().optional(),
  top_provider: z
    .object({
      context_length: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
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

const KiloResponseSchema = z.object({
  data: z.array(KiloModelSchema),
});

function isZeroPrice(value: string | number | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'number') return value === 0;
  const trimmed = value.trim();
  if (trimmed === '-1' || trimmed === '') return false;
  return trimmed === '0' || Number(trimmed) === 0;
}

/**
 * Polls Kilo Gateway's public model catalog (zero API keys required)
 * and filters strictly to `$0` models while excluding dynamic `kilo-auto/*` routers.
 */
export async function pollKilo(): Promise<ProviderPollResult> {
  const startedAt = Date.now();
  const config = getProvidersConfig().kilo;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://api.kilo.ai/api/gateway/models');
    const parsed = KiloResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (
        item.id.startsWith('kilo-auto/') ||
        item.id === 'openrouter/free' ||
        item.id === 'openrouter/auto' ||
        /lyria-|whisper|tts|audio/i.test(item.id)
      ) {
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

      const ctx = item.context_length ?? item.top_provider?.context_length ?? null;
      models.push({
        provider_slug: 'kilo',
        provider_model_id: item.id,
        raw_display_name: item.name ?? item.id,
        context_window: ctx && ctx > 0 ? ctx : null,
        supports_tools: item.supported_parameters
          ? item.supported_parameters.includes('tools')
          : null,
        supports_vision: item.architecture?.input_modalities
          ? item.architecture.input_modalities.includes('image')
          : null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    const freeIds = new Set(
      models
        .filter((m) => m.provider_model_id.endsWith(':free'))
        .map((m) => m.provider_model_id)
    );
    const dedupedModels = models.filter(
      (m) => m.provider_model_id.endsWith(':free') || !freeIds.has(`${m.provider_model_id}:free`)
    );

    return {
      provider_slug: 'kilo',
      ok: true,
      models: dedupedModels,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'kilo',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
