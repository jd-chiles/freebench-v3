import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const COHERE_NON_CHAT_REGEX = /embed|rerank/i;

const CohereModelSchema = z.object({
  name: z.string(),
  endpoints: z.array(z.string()).optional(),
  context_length: z.number().int().positive().optional(),
  supports_vision: z.boolean().optional(),
});

const CohereResponseSchema = z.object({
  models: z.array(CohereModelSchema),
});

/**
 * Polls Cohere `/v1/models?endpoint=chat` with a free trial API key (20 RPM / 1,000 calls/mo).
 */
export async function pollCohere(): Promise<ProviderPollResult> {
  const apiKey = process.env.COHERE_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('cohere', 'COHERE_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().cohere;

  try {
    const raw = await fetchJsonWithTimeout<unknown>(
      'https://api.cohere.com/v1/models?endpoint=chat&page_size=100',
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    const parsed = CohereResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.models) {
      if (COHERE_NON_CHAT_REGEX.test(item.name)) {
        continue;
      }
      if (item.endpoints && !item.endpoints.includes('chat')) {
        continue;
      }

      models.push({
        provider_slug: 'cohere',
        provider_model_id: item.name,
        raw_display_name: item.name,
        context_window: item.context_length ?? null,
        supports_tools: true,
        supports_vision: item.supports_vision ?? null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'cohere',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'cohere',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
