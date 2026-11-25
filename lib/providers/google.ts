import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage, missingEnvResult } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const GoogleModelSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  inputTokenLimit: z.number().int().positive().optional(),
  outputTokenLimit: z.number().int().positive().optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
});

const GoogleModelsResponseSchema = z.object({
  models: z.array(GoogleModelSchema).default([]),
  nextPageToken: z.string().optional(),
});

/**
 * Polls Google AI Studio `/v1beta/models`, paginates `nextPageToken`,
 * and cross-references `free_allowlist_prefixes` and `blocklist_substrings`.
 */
export async function pollGoogle(): Promise<ProviderPollResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY?.trim();
  if (!apiKey) {
    return missingEnvResult('google', 'GOOGLE_AI_API_KEY');
  }

  const startedAt = Date.now();
  const config = getProvidersConfig().google;
  const allowlist = config.free_allowlist_prefixes ?? [];
  const blocklist = config.blocklist_substrings ?? [];

  try {
    const models: DiscoveredFreeModel[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('key', apiKey);
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const raw = await fetchJsonWithTimeout<unknown>(url.toString());
      const parsed = GoogleModelsResponseSchema.parse(raw);

      for (const item of parsed.models) {
        if (!item.supportedGenerationMethods?.includes('generateContent')) {
          continue;
        }

        const strippedId = item.name.replace(/^models\//, '');
        const lowerId = strippedId.toLowerCase();

        if (blocklist.some((blocked) => lowerId.includes(blocked.toLowerCase()))) {
          continue;
        }

        const isFreeAllowed =
          allowlist.length === 0 ||
          allowlist.some((prefix) => lowerId.startsWith(prefix.toLowerCase()));
        if (!isFreeAllowed) {
          continue;
        }

        const supportsVision =
          lowerId.includes('gemini-') || /gemma-3-(4|12|27)b/i.test(lowerId) ? true : null;

        models.push({
          provider_slug: 'google',
          provider_model_id: strippedId,
          raw_display_name: item.displayName ?? strippedId,
          context_window: item.inputTokenLimit ?? null,
          supports_tools: lowerId.includes('gemma-') ? null : true,
          supports_vision: supportsVision,
          rpm_limit: config.rpm_limit,
          rpd_limit: config.rpd_limit,
          tier_type: config.tier_type,
          trains_on_data: true,
          requires_credit_card: config.requires_credit_card,
          signup_url: config.signup_url,
        });
      }

      pageToken = parsed.nextPageToken;
      pageCount += 1;
    } while (pageToken && pageCount < 20);

    const stableIds = new Set(models.map((m) => m.provider_model_id));
    const dedupedModels = models.filter(
      (m) =>
        !m.provider_model_id.endsWith('-preview') ||
        !stableIds.has(m.provider_model_id.replace(/-preview$/i, ''))
    );

    return {
      provider_slug: 'google',
      ok: true,
      models: dedupedModels,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'google',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
