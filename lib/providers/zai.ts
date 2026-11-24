import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const ZaiModelSchema = z.object({
  id: z.string(),
});

const ZaiResponseSchema = z.object({
  data: z.array(ZaiModelSchema),
});

/**
 * Polls Z.AI `/api/paas/v4/models` and restricts to configured free Flash allowlist prefixes.
 */
export async function pollZai(): Promise<ProviderPollResult> {
  const apiKey = process.env.ZAI_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('zai', 'ZAI_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().zai;
  const allowlist = config.free_allowlist_prefixes ?? [];

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://api.z.ai/api/paas/v4/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const parsed = ZaiResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      const lower = item.id.toLowerCase();
      const allowed =
        allowlist.length === 0 ||
        allowlist.some((prefix) => lower.startsWith(prefix.toLowerCase()));
      if (!allowed) {
        continue;
      }

      models.push({
        provider_slug: 'zai',
        provider_model_id: item.id,
        raw_display_name: item.id,
        context_window: 131072,
        supports_tools: true,
        supports_vision: /4v|vision/i.test(item.id) ? true : null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'zai',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'zai',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
