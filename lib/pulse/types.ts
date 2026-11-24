import { z } from 'zod';
import pulseSourcesRaw from '@/config/pulse-sources.json';
import type { PulseItemRecord } from '@/lib/supabase/types';

export type PulseCandidate = Omit<PulseItemRecord, 'id' | 'fetched_at'>;

export interface PulseSourcePollResult {
  source_id: string;
  ok: boolean;
  items: PulseCandidate[];
  error?: string;
}

export const PulseSourcesConfigSchema = z.object({
  github_releases: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      repo: z.string(),
      tags: z.array(z.string()),
    })
  ),
  bluesky_accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      handle: z.string(),
      tags: z.array(z.string()),
      include_keywords: z.array(z.string()),
    })
  ),
  rss_feeds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string().url(),
      source_type: z.enum(['kol', 'agent_release', 'provider_news', 'hf_trending', 'freebench_event']),
      tags: z.array(z.string()),
    })
  ),
  huggingface_trending: z.object({
    enabled: z.boolean(),
    limit: z.number().int().positive(),
  }),
  x_list_url: z.string().url().nullable().optional(),
  x_watchlist: z.array(
    z.object({
      name: z.string(),
      handle: z.string(),
      role: z.string(),
      tags: z.array(z.string()),
      profile_url: z.string().url(),
    })
  ),
});

export type PulseSourcesConfig = z.infer<typeof PulseSourcesConfigSchema>;

let cachedPulseConfig: PulseSourcesConfig | null = null;

/**
 * Loads and Zod-validates `config/pulse-sources.json`.
 */
export function getPulseSourcesConfig(): PulseSourcesConfig {
  if (!cachedPulseConfig) {
    cachedPulseConfig = PulseSourcesConfigSchema.parse(pulseSourcesRaw);
  }
  return cachedPulseConfig;
}
