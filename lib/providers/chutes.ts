import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const CHUTES_NON_CHAT_REGEX = /embed|whisper|audio|rerank|tts/i;

const ChutesModelSchema = z.object({
  id: z.string(),
  context_length: z.number().int().positive().optional(),
  max_model_len: z.number().int().positive().optional(),
  price: z
    .object({
      input: z.object({ usd: z.number().optional() }).optional(),
      output: z.object({ usd: z.number().optional() }).optional(),
    })
    .optional(),
});

const ChutesResponseSchema = z.object({
  data: z.array(ChutesModelSchema),
});

/**
 * Polls Chutes AI's OpenAI-compatible `/v1/models` endpoint and excludes non-chat utilities.
 */
export async function pollChutes(): Promise<ProviderPollResult> {
  const apiKey = process.env.CHUTES_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('chutes', 'CHUTES_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().chutes;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://llm.chutes.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const parsed = ChutesResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (CHUTES_NON_CHAT_REGEX.test(item.id)) {
        continue;
      }
      const inUsd = item.price?.input?.usd ?? 0;
      const outUsd = item.price?.output?.usd ?? 0;
      if (inUsd > 0 || outUsd > 0) {
        continue;
      }

      models.push({
        provider_slug: 'chutes',
        provider_model_id: item.id,
        raw_display_name: item.id,
        context_window: item.context_length ?? item.max_model_len ?? null,
        supports_tools: null,
        supports_vision: /vl|vision/i.test(item.id) ? true : null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'chutes',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'chutes',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
