import type { Metadata } from 'next';
import Link from 'next/link';
import { Rss } from 'lucide-react';
import { ChangelogClient } from '@/components/changelog/ChangelogClient';
import { getChangelogEvents } from '@/lib/data/queries';
import { getProvidersConfig } from '@/lib/providers/types';

export const revalidate = 21600;

const providerCount = Object.keys(getProvidersConfig()).length;

export const metadata: Metadata = {
  title: 'Free LLM Changelog — Newly Added, Quota Changes & Dropped Free Models',
  description: `Automated changelog tracking every model added to, quota-updated, or dropped from ${providerCount} free-tier LLM API providers, plus #1 leaderboard takeovers.`,
};

export default async function ChangelogPage() {
  const { events } = await getChangelogEvents();

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            Free LLM Radar Changelog
          </h1>
          <p className="max-w-2xl text-sm text-zinc-400">
            Automatically updated whenever a free-tier provider adds a model, shifts rate limits,
            deprecates an endpoint, or a new #1 leader emerges.
          </p>
        </div>

        <Link
          href="/feed.xml"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 hover:border-emerald-500/40"
        >
          <Rss className="h-3.5 w-3.5 text-amber-400" />
          <span>Subscribe via RSS</span>
        </Link>
      </section>

      <ChangelogClient events={events} />
    </div>
  );
}
