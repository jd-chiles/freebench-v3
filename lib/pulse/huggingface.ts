import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage } from '@/lib/providers/http';
import type { PulseCandidate, PulseSourcePollResult } from './types';

const HuggingFaceModelSchema = z.object({
  id: z.string(),
  pipeline_tag: z.string().optional(),
  downloads: z.number().optional(),
  likes: z.number().optional(),
  createdAt: z.string().optional(),
  lastModified: z.string().optional(),
});

const HuggingFaceListSchema = z.array(HuggingFaceModelSchema);

/**
 * Fetches trending text-generation models from Hugging Face's free public API.
 */
export async function pollHuggingFaceTrending(limit: number = 8): Promise<PulseSourcePollResult> {
  try {
    const url = `https://huggingface.co/api/models?pipeline_tag=text-generation&sort=trendingScore&direction=-1&limit=${limit}`;
    const raw = await fetchJsonWithTimeout<unknown>(url);
    const models = HuggingFaceListSchema.parse(raw);

    const items: PulseCandidate[] = models.map((model) => {
      const likesText = typeof model.likes === 'number' ? `${model.likes} likes` : 'trending';
      const downloadsText =
        typeof model.downloads === 'number'
          ? `${model.downloads.toLocaleString('en-US')} downloads`
          : '';
      const summary = [likesText, downloadsText].filter(Boolean).join(' · ');

      return {
        source_id: 'hf-trending',
        source_name: 'Hugging Face Trending',
        source_handle: 'huggingface.co',
        source_type: 'hf_trending',
        category_tags: ['open-weights', 'trending'],
        title: `Trending open model: ${model.id}`,
        summary: summary || 'Trending text-generation release on Hugging Face',
        url: `https://huggingface.co/${model.id}`,
        published_at: model.lastModified ?? model.createdAt ?? new Date().toISOString(),
      };
    });

    return {
      source_id: 'hf-trending',
      ok: true,
      items,
    };
  } catch (error) {
    return {
      source_id: 'hf-trending',
      ok: false,
      items: [],
      error: formatErrorMessage(error),
    };
  }
}
