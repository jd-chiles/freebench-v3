import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const GROQ_NON_CHAT_REGEX = /whisper|tts|playai|orpheus|guard|safeguard|embed|moderation/i;

const GroqModelSchema = z.object({
  id: z.string(),
  owned_by: z.string().optional(),
  active: z.boolean().optional(),
  context_window: z.number().int().positive().optional(),
});

const GroqResponseSchema = z.object({
  data: z.array(GroqModelSchema),
});

/**
 * Polls Groq's OpenAI-compatible `/openai/v1/models` endpoint and filters out audio/guard/embed models.
 */
export async function pollGroq(): Promise<ProviderPollResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('groq', 'GROQ_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().groq;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const parsed = GroqResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (item.active === false) {
        continue;
      }
      if (GROQ_NON_CHAT_REGEX.test(item.id)) {
        continue;
      }

      models.push({
        provider_slug: 'groq',
        provider_model_id: item.id,
        raw_display_name: item.id,
        context_window: item.context_window ?? null,
        supports_tools: true,
        supports_vision: /vision|scout|maverick/i.test(item.id) ? true : null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'groq',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'groq',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
