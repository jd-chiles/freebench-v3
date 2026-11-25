import { formatErrorMessage } from '@/lib/providers/http';
import { pollBlueskyAccount } from './bluesky';
import { pollHuggingFaceTrending } from './huggingface';
import { pollRssOrAtomFeed } from './rss';
import {
  getPulseSourcesConfig,
  type PulseCandidate,
  type PulseSourcePollResult,
} from './types';

export interface PulseAggregateResult {
  items: PulseCandidate[];
  results: PulseSourcePollResult[];
}

/**
 * Deduplicates pulse rows by `url`, keeping the latest entry per unique URL
 * so Postgres `ON CONFLICT (url) DO UPDATE` never receives duplicate keys in one batch.
 */
export function dedupePulseItemsByUrl<T extends { url: string }>(
  items: ReadonlyArray<T>
): T[] {
  const byUrl = new Map<string, T>();
  for (const item of items) {
    byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}

/**
 * Concurrently polls all configured zero-cost pulse feeds:
 * GitHub agent releases, Bluesky KOL accounts, RSS/Atom feeds, and HF trending.
 */
export async function pollAllPulseSources(): Promise<PulseAggregateResult> {
  const config = getPulseSourcesConfig();
  const tasks: Array<Promise<PulseSourcePollResult>> = [];

  for (const repo of config.github_releases) {
    tasks.push(
      pollRssOrAtomFeed({
        source_id: repo.id,
        source_name: repo.name,
        source_handle: repo.repo,
        source_type: 'agent_release',
        url: `https://github.com/${repo.repo}/releases.atom`,
        tags: repo.tags,
        limit: 4,
      })
    );
  }

  for (const account of config.bluesky_accounts) {
    tasks.push(
      pollBlueskyAccount({
        source_id: account.id,
        source_name: account.name,
        handle: account.handle,
        tags: account.tags,
        include_keywords: account.include_keywords,
      })
    );
  }

  for (const feed of config.rss_feeds) {
    tasks.push(
      pollRssOrAtomFeed({
        source_id: feed.id,
        source_name: feed.name,
        source_type: feed.source_type,
        url: feed.url,
        tags: feed.tags,
        limit: 5,
      })
    );
  }

  if (config.huggingface_trending.enabled) {
    tasks.push(pollHuggingFaceTrending(config.huggingface_trending.limit));
  }

  const settled = await Promise.allSettled(tasks);
  const results: PulseSourcePollResult[] = settled.map((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    return {
      source_id: `pulse-task-${index}`,
      ok: false,
      items: [],
      error: formatErrorMessage(outcome.reason),
    };
  });

  const dedupedByUrl = new Map<string, PulseCandidate>();
  for (const result of results) {
    if (!result.ok) continue;
    for (const item of result.items) {
      if (!dedupedByUrl.has(item.url)) {
        dedupedByUrl.set(item.url, item);
      }
    }
  }

  const items = [...dedupedByUrl.values()].sort(
    (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)
  );

  return { items, results };
}
