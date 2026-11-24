'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bookmark, ExternalLink, Radio, Search } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';
import { loadMyKeys } from '@/lib/providers/my-keys';
import { loadMyStack, type PinnedStackItem } from '@/lib/providers/my-stack';
import type { ProviderSlug, PulseItemRecord } from '@/lib/supabase/types';

interface WatchlistAccount {
  name: string;
  handle: string;
  role: string;
  tags: string[];
  profile_url: string;
}

interface PulseClientProps {
  items: PulseItemRecord[];
  watchlist: WatchlistAccount[];
  xListUrl: string | null;
}

type SourceFilter = 'all' | PulseItemRecord['source_type'];

const SOURCE_FILTERS: ReadonlyArray<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'All Signals' },
  { id: 'freebench_event', label: 'FreeBench Drops' },
  { id: 'agent_release', label: 'Agent Releases' },
  { id: 'kol', label: 'KOL & Blogs' },
  { id: 'hf_trending', label: 'HF Trending' },
];

const SOURCE_BADGE_CLASS: Record<PulseItemRecord['source_type'], string> = {
  freebench_event: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  agent_release: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
  kol: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
  provider_news: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  hf_trending: 'border-pink-500/40 bg-pink-500/15 text-pink-300',
};

export function PulseClient({ items, watchlist, xListUrl }: PulseClientProps) {
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [query, setQuery] = useState('');
  const [myStackOnly, setMyStackOnly] = useState(false);
  const [pinnedStack, setPinnedStack] = useState<PinnedStackItem[]>([]);
  const [myKeys, setMyKeys] = useState<ProviderSlug[]>([]);

  useEffect(() => {
    setPinnedStack(loadMyStack());
    setMyKeys(loadMyKeys());
  }, []);

  const stackKeywords = useMemo(() => {
    const terms = new Set<string>();
    for (const pin of pinnedStack) {
      terms.add(pin.canonicalId.toLowerCase());
      terms.add(pin.displayName.toLowerCase());
    }
    for (const slug of myKeys) {
      terms.add(slug.toLowerCase());
    }
    return [...terms].filter(Boolean);
  }, [pinnedStack, myKeys]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== 'all' && item.source_type !== filter) return false;
      const hay = [
        item.title,
        item.summary ?? '',
        item.source_name,
        item.url,
        ...item.category_tags,
      ]
        .join(' ')
        .toLowerCase();

      if (q && !hay.includes(q)) return false;
      if (myStackOnly && stackKeywords.length > 0 && !stackKeywords.some((kw) => hay.includes(kw))) {
        return false;
      }
      if (myStackOnly && stackKeywords.length === 0) return false;
      return true;
    });
  }, [items, filter, query, myStackOnly, stackKeywords]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Main live feed */}
      <div className="space-y-4 lg:col-span-2">
        <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {SOURCE_FILTERS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === tab.id
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {tab.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setMyStackOnly((prev) => !prev)}
              aria-pressed={myStackOnly}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                myStackOnly
                  ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <Bookmark className="h-3.5 w-3.5" />
              <span>My Stack ({pinnedStack.length + myKeys.length})</span>
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search drops, OpenCode, Hermes, DeepSeek, provider news..."
              aria-label="Search Pulse items"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-9 pr-3 text-xs text-zinc-100 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-xs text-zinc-400">
            {myStackOnly && stackKeywords.length === 0
              ? 'Pin models or select your saved free keys on the leaderboard to filter Pulse signals for your stack.'
              : 'No Pulse signals match your current search/filter.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => (
              <article
                key={item.url}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        SOURCE_BADGE_CLASS[item.source_type]
                      }`}
                    >
                      {item.source_type.replace('_', ' ')}
                    </span>
                    <span className="text-xs font-semibold text-zinc-200">{item.source_name}</span>
                    {item.source_handle ? (
                      <span className="font-mono text-[11px] text-zinc-400">
                        {item.source_handle}
                      </span>
                    ) : null}
                  </div>
                  <span className="font-mono text-[11px] text-zinc-400">
                    {formatRelativeTime(item.published_at)}
                  </span>
                </div>

                <h2 className="mt-2 text-sm font-semibold text-zinc-100">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-emerald-400"
                  >
                    <span>{item.title}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  </a>
                </h2>

                {item.summary ? (
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{item.summary}</p>
                ) : null}

                {item.category_tags.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {item.category_tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Curated X Watchlist Sidebar */}
      <aside className="space-y-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-200">
              <Radio className="h-3.5 w-3.5 text-emerald-400" />
              <span>Curated X KOL Watchlist</span>
            </div>
            {xListUrl ? (
              <a
                href={xListUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-emerald-400 hover:underline"
              >
                Open X List
              </a>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-zinc-400">
            Reliable builders and accounts posting free model drops, Codex quota resets, OpenCode,
            Hermes Agent, Freebuff, and OpenClaw updates.
          </p>

          <div className="mt-4 space-y-2.5">
            {watchlist.map((account) => (
              <a
                key={account.handle}
                href={account.profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-3 transition-colors hover:border-emerald-500/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-100">{account.name}</span>
                  <span className="font-mono text-[11px] text-emerald-400">{account.handle}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{account.role}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {account.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </a>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
