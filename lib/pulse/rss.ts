import { fetchTextWithTimeout, formatErrorMessage } from '@/lib/providers/http';
import type { PulseItemRecord } from '@/lib/supabase/types';
import type { PulseCandidate, PulseSourcePollResult } from './types';

function safeFromCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return '';
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&rsquo;|&apos;|&#39;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;|&quot;/gi, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(block);
  if (!match?.[1]) return null;
  const decoded = decodeXmlEntities(match[1]);
  return decoded || null;
}

function extractAtomLink(block: string): string | null {
  const alternateMatch = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(
    block
  );
  if (alternateMatch?.[1]) return alternateMatch[1].trim();

  const hrefMatch = /<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  if (hrefMatch?.[1]) return hrefMatch[1].trim();

  return extractTag(block, 'link');
}

function normalizeIsoDate(rawDate: string | null): string {
  if (!rawDate) return new Date().toISOString();
  const parsed = Date.parse(rawDate);
  if (Number.isNaN(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

/**
 * Parses Atom (`<entry>`) or RSS 2.0 (`<item>`) XML text into normalized Pulse candidates.
 */
export function parseFeedXml(
  xmlText: string,
  meta: {
    source_id: string;
    source_name: string;
    source_handle?: string | null;
    source_type: PulseItemRecord['source_type'];
    tags: string[];
    limit?: number;
  }
): PulseCandidate[] {
  const limit = meta.limit ?? 8;
  const items: PulseCandidate[] = [];

  const atomEntries = [...xmlText.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];
  const rssItems = [...xmlText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  const blocks = atomEntries.length > 0 ? atomEntries : rssItems;

  for (const match of blocks.slice(0, limit)) {
    const block = match[1];
    if (!block) continue;

    const title = extractTag(block, 'title');
    const url = extractAtomLink(block);
    if (!title || !url) continue;

    const rawSummary =
      extractTag(block, 'summary') ??
      extractTag(block, 'description') ??
      extractTag(block, 'content');
    const summary = rawSummary ? rawSummary.slice(0, 280) : null;
    const rawDate =
      extractTag(block, 'updated') ??
      extractTag(block, 'published') ??
      extractTag(block, 'pubDate');

    items.push({
      source_id: meta.source_id,
      source_name: meta.source_name,
      source_handle: meta.source_handle ?? null,
      source_type: meta.source_type,
      category_tags: meta.tags,
      title,
      summary,
      url,
      published_at: normalizeIsoDate(rawDate),
    });
  }

  return items;
}

/**
 * Fetches and parses an Atom or RSS feed with a 15-second timeout.
 */
export async function pollRssOrAtomFeed(meta: {
  source_id: string;
  source_name: string;
  source_handle?: string | null;
  source_type: PulseItemRecord['source_type'];
  url: string;
  tags: string[];
  limit?: number;
}): Promise<PulseSourcePollResult> {
  try {
    const xmlText = await fetchTextWithTimeout(meta.url, {
      headers: {
        'User-Agent': 'FreeBench/0.0.1',
        Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml',
      },
    });
    const items = parseFeedXml(xmlText, meta);
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
