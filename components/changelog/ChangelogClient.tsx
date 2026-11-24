'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bookmark,
  Crown,
  Gauge,
  Rss,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';
import { loadMyStack, type PinnedStackItem } from '@/lib/providers/my-stack';
import type { AvailabilityEventRecord } from '@/lib/supabase/types';

interface ChangelogClientProps {
  events: AvailabilityEventRecord[];
}

type EventFilterTab = 'all' | 'drops_quota' | 'model_added' | 'new_leader';

const TABS: ReadonlyArray<{ id: EventFilterTab; label: string }> = [
  { id: 'all', label: 'All Events' },
  { id: 'drops_quota', label: 'Drops & Quota' },
  { id: 'model_added', label: 'Added Free' },
  { id: 'new_leader', label: '#1 Leaders' },
];

/**
 * Interactive changelog viewer supporting Drops/Quota filtering, Pinned Stack filtering,
 * and tailored RSS alert feed generation.
 */
export function ChangelogClient({ events }: ChangelogClientProps) {
  const [tab, setTab] = useState<EventFilterTab>('all');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [pinnedStack, setPinnedStack] = useState<PinnedStackItem[]>([]);

  useEffect(() => {
    setPinnedStack(loadMyStack());
  }, []);

  const pinnedIdSet = useMemo(
    () => new Set(pinnedStack.map((item) => item.canonicalId)),
    [pinnedStack]
  );

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (
        tab === 'drops_quota' &&
        evt.event_type !== 'model_dropped' &&
        evt.event_type !== 'quota_changed'
      ) {
        return false;
      }
      if (tab === 'model_added' && evt.event_type !== 'model_added') return false;
      if (tab === 'new_leader' && evt.event_type !== 'new_leader') return false;
      if (pinnedOnly && !pinnedIdSet.has(evt.canonical_id)) return false;
      return true;
    });
  }, [events, tab, pinnedOnly, pinnedIdSet]);

  const rssHref = useMemo(() => {
    const params = new URLSearchParams();
    if (tab === 'drops_quota') params.set('type', 'drops');
    else params.set('type', 'events');
    if (pinnedOnly && pinnedStack.length > 0) {
      params.set(
        'model',
        pinnedStack.map((item) => item.canonicalId).join(',')
      );
    }
    const qs = params.toString();
    return qs ? `/feed.xml?${qs}` : '/feed.xml';
  }, [tab, pinnedOnly, pinnedStack]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === item.id
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {item.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setPinnedOnly((prev) => !prev)}
            aria-pressed={pinnedOnly}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              pinnedOnly
                ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span>My Pinned Stack ({pinnedStack.length})</span>
          </button>
        </div>

        <Link
          href={rssHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200 hover:border-amber-500/50"
        >
          <Rss className="h-3.5 w-3.5 text-amber-400" />
          <span>{pinnedOnly || tab === 'drops_quota' ? 'Filtered RSS' : 'RSS Feed'}</span>
        </Link>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-xs text-zinc-400">
          {pinnedOnly && pinnedStack.length === 0
            ? 'No models pinned in your stack yet. Pin models from the leaderboard to track their drops and quota changes here.'
            : 'No changelog events match your current filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((evt) => {
            const badge =
              evt.event_type === 'new_leader'
                ? {
                    label: '#1 Leader',
                    icon: Crown,
                    cls: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
                  }
                : evt.event_type === 'model_added'
                  ? {
                      label: 'Added Free',
                      icon: ArrowUpRight,
                      cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
                    }
                  : evt.event_type === 'quota_changed'
                    ? {
                        label: 'Quota Changed',
                        icon: Gauge,
                        cls: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
                      }
                    : {
                        label: 'Dropped',
                        icon: ArrowDownRight,
                        cls: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
                      };
            const Icon = badge.icon;

            return (
              <article
                key={evt.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] ${badge.cls}`}
                    >
                      <Icon className="h-3 w-3" />
                      <span>{badge.label}</span>
                    </span>
                    {evt.provider_slug ? (
                      <Link
                        href={`/providers/${evt.provider_slug}`}
                        className="font-mono text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        @{evt.provider_slug}
                      </Link>
                    ) : null}
                  </div>
                  <span className="font-mono text-xs text-zinc-400">
                    {formatRelativeTime(evt.detected_at)}
                  </span>
                </div>

                <h2 className="mt-2 text-sm font-semibold text-zinc-100">
                  <Link
                    href={`/models/${encodeURIComponent(evt.canonical_id)}`}
                    className="hover:text-emerald-400"
                  >
                    {evt.headline}
                  </Link>
                </h2>

                <p className="mt-1 text-xs text-zinc-400">{evt.summary_md.replace(/[*`]/g, '')}</p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
