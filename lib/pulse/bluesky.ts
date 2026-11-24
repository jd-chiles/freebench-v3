import { z } from 'zod';
import { fetchJsonWithTimeout, formatErrorMessage } from '@/lib/providers/http';
import type { PulseCandidate, PulseSourcePollResult } from './types';

const BlueskyFeedSchema = z.object({
  feed: z
    .array(
      z.object({
        reason: z
          .object({
            $type: z.string().optional(),
          })
          .optional(),
        post: z.object({
          uri: z.string(),
          record: z.object({
            text: z.string().optional(),
            createdAt: z.string().optional(),
          }),
          author: z.object({
            handle: z.string(),
            displayName: z.string().optional(),
          }),
        }),
      })
    )
    .default([]),
});

export function extractPostUrl(handle: string, uri: string): string {
  const rkey = uri.split('/').pop() ?? '';
  return `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`;
}

/**
 * Filters a Bluesky author feed response by high-signal keywords without any API auth,
 * excluding reposts so only original posts from the target account appear.
 */
export function filterBlueskyFeed(
  rawJson: unknown,
  meta: {
    source_id: string;
    source_name: string;
    handle: string;
    tags: string[];
    include_keywords: string[];
  }
): PulseCandidate[] {
  const parsed = BlueskyFeedSchema.parse(rawJson);
  const lowerKeywords = meta.include_keywords.map((k) => k.toLowerCase());
  const expectedHandle = meta.handle.toLowerCase();
  const candidates: PulseCandidate[] = [];

  for (const item of parsed.feed) {
    if (item.reason?.$type?.toLowerCase().includes('repost')) continue;
    const authorHandle = item.post.author.handle.toLowerCase();
    if (expectedHandle && authorHandle && authorHandle !== expectedHandle) continue;

    const text = item.post.record.text?.trim();
    if (!text) continue;

    const lowerText = text.toLowerCase();
    const matchesKeyword =
      lowerKeywords.length === 0 || lowerKeywords.some((kw) => lowerText.includes(kw));
    if (!matchesKeyword) continue;

    const firstLine = text.split('\n')[0]?.trim() ?? text;
    const title = firstLine.length > 110 ? `${firstLine.slice(0, 107)}...` : firstLine;
    const summary = text.length > 260 ? `${text.slice(0, 257)}...` : text;
    const handle = item.post.author.handle || meta.handle;

    candidates.push({
      source_id: meta.source_id,
      source_name: item.post.author.displayName ?? meta.source_name,
      source_handle: `@${handle}`,
      source_type: 'kol',
      category_tags: meta.tags,
      title,
      summary,
      url: extractPostUrl(handle, item.post.uri),
      published_at: item.post.record.createdAt ?? new Date().toISOString(),
    });
  }

  return candidates;
}

/**
 * Fetches public posts from a Bluesky account via the unauthenticated AT Protocol API.
 */
export async function pollBlueskyAccount(meta: {
  source_id: string;
  source_name: string;
  handle: string;
  tags: string[];
  include_keywords: string[];
}): Promise<PulseSourcePollResult> {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(
      meta.handle
    )}&limit=15&filter=posts_no_replies`;

    const raw = await fetchJsonWithTimeout<unknown>(url);
    const items = filterBlueskyFeed(raw, meta);

    return {
      source_id: meta.source_id,
      ok: true,
      items,
    };
  } catch (error) {
    return {
      source_id: meta.source_id,
      ok: false,
      items: [],
      error: formatErrorMessage(error),
    };
  }
}
