import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const SAMBANOVA_NON_CHAT_REGEX = /whisper|audio|embed/i;

const SambaNovaModelSchema = z.object({
  id: z.string(),
  context_length: z.number().int().positive().optional(),
});

const SambaNovaResponseSchema = z.object({
  data: z.array(SambaNovaModelSchema),
});

/**
 * Polls SambaNova Cloud `/v1/models` and excludes audio/embedding endpoints.
 */
export async function pollSambaNova(): Promise<ProviderPollResult> {
  const apiKey = process.env.SAMBANOVA_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('sambanova', 'SAMBANOVA_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().sambanova;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://api.sambanova.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const parsed = SambaNovaResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (SAMBANOVA_NON_CHAT_REGEX.test(item.id)) {
        continue;
      }

      models.push({
        provider_slug: 'sambanova',
        provider_model_id: item.id,
        raw_display_name: item.id,
        context_window: item.context_length ?? null,
        supports_tools: null,
        supports_vision: /vision/i.test(item.id) ? true : null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'sambanova',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'sambanova',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
