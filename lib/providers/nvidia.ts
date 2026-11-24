import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage } from './http';
import { getProvidersConfig, type DiscoveredFreeModel, type ProviderPollResult } from './types';

const NVIDIA_NON_CHAT_REGEX =
  /embed|rerank|bge|nvclip|stable-diffusion|flux|sdxl|cosmos|reward|parse|ocr|deplot|pdf|retriever|guard|shield|speech|riva|parakeet|canary|audio|diffusion|3d|trellis|genmol|evo2|alphafold|detector|pii|content-safety|calibration|gliner/i;

const NvidiaModelSchema = z.object({
  id: z.string(),
  owned_by: z.string().optional(),
  context_length: z.number().int().positive().optional(),
});

const NvidiaResponseSchema = z.object({
  data: z.array(NvidiaModelSchema),
});

/**
 * Polls NVIDIA NIM's public `/v1/models` catalog (works keyless; attaches Bearer token if `NVIDIA_API_KEY` is set)
 * and strips non-chat microservices (embeddings, OCR, diffusion, etc.).
 */
export async function pollNvidia(): Promise<ProviderPollResult> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  const startedAt = Date.now();
  const config = getProvidersConfig().nvidia;

  try {
    const raw = await fetchJsonWithTimeout<unknown>('https://integrate.api.nvidia.com/v1/models', {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    const parsed = NvidiaResponseSchema.parse(raw);

    const models: DiscoveredFreeModel[] = [];
    for (const item of parsed.data) {
      if (NVIDIA_NON_CHAT_REGEX.test(item.id)) {
        continue;
      }

      models.push({
        provider_slug: 'nvidia',
        provider_model_id: item.id,
        raw_display_name: item.id,
        context_window: item.context_length ?? null,
        supports_tools: null,
        supports_vision: /vl|vision|vlm/i.test(item.id) ? true : null,
        rpm_limit: config.rpm_limit,
        rpd_limit: config.rpd_limit,
        tier_type: config.tier_type,
        trains_on_data: config.trains_on_data,
        requires_credit_card: config.requires_credit_card,
        signup_url: config.signup_url,
      });
    }

    return {
      provider_slug: 'nvidia',
      ok: true,
      models,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider_slug: 'nvidia',
      ok: false,
      models: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
