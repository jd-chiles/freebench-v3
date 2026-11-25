import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const MISTRAL_NON_CHAT_REGEX = /voxtral|embed|moderation|ocr|^mistral-vibe-cli/i;

const MistralModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  max_context_length: z.number().int().positive().optional(),
  capabilities: z
    .object({
      completion_chat: z.boolean().optional(),
      function_calling: z.boolean().optional(),
      vision: z.boolean().optional(),
    })
    .optional(),
  deprecation: z.string().nullable().optional(),
  aliases: z.array(z.string()).optional(),
});

const MistralResponseSchema = z.object({
  data: z.array(MistralModelSchema),
});

function isDeprecated(deprecation: string | null | undefined, nowMs: number): boolean {
  if (!deprecation) return false;
  const parsed = Date.parse(deprecation);
  if (Number.isNaN(parsed)) return false;
  return parsed <= nowMs;
}

/**
 * Polls Mistral `/v1/models`, requires `completion_chat`, deduplicates `-latest` aliases,
 * and enforces `trains_on_data: true` for Free mode.
 */
export async function pollMistral(): Promise<ProviderPollResult> {
  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('mistral', 'MISTRAL_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().mistral;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://api.mistral.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const parsed = MistralResponseSchema.parse(raw);

    const nowMs = Date.now();
    const aliasedIds = new Set<string>();
    for (const item of parsed.data) {
      for (const alias of item.aliases ?? []) {
        if (alias !== item.id) {
          aliasedIds.add(alias);
        }
      }
    }

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (item.capabilities?.completion_chat !== true) {
        continue;
      }
      if (MISTRAL_NON_CHAT_REGEX.test(item.id)) {
        continue;
      }
      if (isDeprecated(item.deprecation, nowMs)) {
        continue;
      }
      if (aliasedIds.has(item.id)) {
        continue;
      }

      models.push({
        provider_slug: 'mistral',
        provider_model_id: item.id,
        raw_display_name: item.name ?? item.id,
        context_window: item.max_context_length ?? null,
        supports_tools: item.capabilities?.function_calling ?? null,
        supports_vision: item.capabilities?.vision ?? null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: true,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'mistral',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'mistral',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
