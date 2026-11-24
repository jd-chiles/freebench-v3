import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const OpenCodeModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  modalities: z
    .object({
      input: z.array(z.string()).optional(),
      output: z.array(z.string()).optional(),
    })
    .optional(),
  capabilities: z
    .object({
      tools: z
        .object({
          supported: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  limit: z
    .object({
      context: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
  cost: z
    .object({
      text: z
        .object({
          input: z.object({ price: z.number().optional() }).optional(),
          output: z.object({ price: z.number().optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

const OpenCodeResponseSchema = z.object({
  data: z.array(OpenCodeModelSchema),
});

/**
 * Polls OpenCode Zen's public `/zen/v1/models` endpoint (zero API keys required)
 * and keeps zero-cost chat models (`cost.text.input.price === 0 && output.price === 0`).
 */
export async function pollOpenCode(): Promise<ProviderPollResult> {
  const startedAt = Date.now();
  const config = getProvidersConfig().opencode;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://opencode.ai/zen/v1/models');
    const parsed = OpenCodeResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (item.type !== undefined && item.type !== 'chat') {
        continue;
      }

      const inputPrice = item.cost?.text?.input?.price;
      const outputPrice = item.cost?.text?.output?.price;
      if (inputPrice !== 0 || outputPrice !== 0) {
        continue;
      }

      const ctx = item.limit?.context;
      models.push({
        provider_slug: 'opencode',
        provider_model_id: item.id,
        raw_display_name: item.name ?? item.id,
        context_window: ctx && ctx > 0 ? ctx : null,
        supports_tools: item.capabilities?.tools?.supported ?? null,
        supports_vision: item.modalities?.input
          ? item.modalities.input.includes('image')
          : null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'opencode',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'opencode',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
