import type { Metadata } from 'next';
import Link from 'next/link';
import { Rss } from 'lucide-react';
import { PulseClient } from '@/components/pulse/PulseClient';
import { getPulsePageData, getXWatchlist } from '@/lib/data/queries';

export const revalidate = 21600;

export const metadata: Metadata = {
  title: 'Model Pulse & KOL Radar — Live Free LLM & Agent Updates',
  description:
    'Zero-cost live radar combining FreeBench model availability events, OpenCode/Hermes/Freebuff releases, Bluesky KOL posts, and Hugging Face trending drops.',
};

export default async function PulsePage() {
  const [{ items }, { watchlist, xListUrl }] = await Promise.all([
    getPulsePageData(),
    Promise.resolve(getXWatchlist()),
  ]);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            Model Pulse & KOL Radar
          </h1>
          <p className="max-w-2xl text-sm text-zinc-400">
            Live feed of free model drops, coding-agent releases (OpenCode, Hermes Agent, Freebuff,
            Cline, Aider), Bluesky AI KOL signals, and curated X accounts to follow.
          </p>
        </div>

        <Link
          href="/feed.xml"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300"
        >
          <Rss className="h-3.5 w-3.5 text-amber-400" />
          <span>RSS Feed</span>
        </Link>
      </section>

      <PulseClient items={items} watchlist={watchlist} xListUrl={xListUrl} />
    </div>
  );
}
