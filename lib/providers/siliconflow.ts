import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const SILICONFLOW_NON_CHAT_REGEX = /embed|rerank|whisper|audio|tts/i;

const SiliconFlowModelSchema = z.object({
  id: z.string(),
});

const SiliconFlowResponseSchema = z.object({
  data: z.array(SiliconFlowModelSchema),
});

/**
 * Polls SiliconFlow `/v1/models?type=text&sub_type=chat`, excluding paid `Pro/` endpoints.
 */
export async function pollSiliconFlow(): Promise<ProviderPollResult> {
  const apiKey = process.env.SILICONFLOW_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('siliconflow', 'SILICONFLOW_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().siliconflow;
  const allowlist = config.free_allowlist_prefixes ?? [];

  try {
    const raw = await fetchJsonWithTimeout<unknown>(
      'https://api.siliconflow.com/v1/models?type=text&sub_type=chat',
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    const parsed = SiliconFlowResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (item.id.startsWith('Pro/')) {
        continue;
      }
      if (SILICONFLOW_NON_CHAT_REGEX.test(item.id)) {
        continue;
      }
      const lower = item.id.toLowerCase();
      const allowed =
        allowlist.length === 0 ||
        allowlist.some((prefix) => lower.startsWith(prefix.toLowerCase()));
      if (!allowed) {
        continue;
      }

      models.push({
        provider_slug: 'siliconflow',
        provider_model_id: item.id,
        raw_display_name: item.id,
        context_window: null,
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
      provider_slug: 'siliconflow',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'siliconflow',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
