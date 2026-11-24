import { z } from 'zod';
import { normalizeModelId } from '@/lib/normalization/normalize';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const CEREBRAS_NON_CHAT_REGEX = /embed|whisper|audio/i;

const CerebrasModelSchema = z.object({
  id: z.string(),
  owned_by: z.string().optional(),
  created: z.number().optional(),
  context_length: z.number().int().positive().optional(),
});

const CerebrasResponseSchema = z.object({
  data: z.array(CerebrasModelSchema),
});

/**
 * Polls Cerebras `/v1/models` and resolves fallback context lengths via `config/aliases.json`.
 */
export async function pollCerebras(): Promise<ProviderPollResult> {
  const apiKey = process.env.CEREBRAS_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('cerebras', 'CEREBRAS_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().cerebras;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://api.cerebras.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const parsed = CerebrasResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (CEREBRAS_NON_CHAT_REGEX.test(item.id)) {
        continue;
      }

      const normalized = normalizeModelId(item.id);
      const contextWindow = item.context_length ?? normalized.fallbackContextWindow ?? null;

      models.push({
        provider_slug: 'cerebras',
        provider_model_id: item.id,
        raw_display_name: item.id,
        context_window: contextWindow,
        supports_tools: true,
        supports_vision: null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'cerebras',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'cerebras',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
