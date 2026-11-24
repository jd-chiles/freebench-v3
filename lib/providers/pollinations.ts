import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const PollinationsModelSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tier: z.string().optional(),
  input_modalities: z.array(z.string()).optional(),
  tools: z.boolean().optional(),
  vision: z.boolean().optional(),
  audio: z.boolean().optional(),
  context_length: z.number().int().nonnegative().nullable().optional(),
});

const PollinationsResponseSchema = z.array(PollinationsModelSchema);

/**
 * Polls Pollinations' unauthenticated `/models` endpoint for anonymous/free text models.
 */
export async function pollPollinations(): Promise<ProviderPollResult> {
  const startedAt = Date.now();
  const config = getProvidersConfig().pollinations;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://text.pollinations.ai/models');
    const parsed = PollinationsResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed) {
      const isFreeTier = item.tier === undefined || item.tier === 'anonymous';
      if (!isFreeTier) {
        continue;
      }

      if (item.audio === true && !item.input_modalities?.includes('text')) {
        continue;
      }

      const ctx = item.context_length;
      models.push({
        provider_slug: 'pollinations',
        provider_model_id: item.name,
        raw_display_name: item.description ?? item.name,
        context_window: ctx && ctx > 0 ? ctx : null,
        supports_tools: item.tools ?? null,
        supports_vision: item.vision ?? null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'pollinations',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'pollinations',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
