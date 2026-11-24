import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, Radio, Sparkles, Terminal } from 'lucide-react';
import { JsonLd } from '@/components/JsonLd';
import { SponsorSlot } from '@/components/SponsorSlot';
import { LeaderboardClient } from '@/components/leaderboard/LeaderboardClient';
import { getLeaderboardData, TASK_DEFINITIONS } from '@/lib/data/queries';
import { formatRelativeTime } from '@/lib/format';
import { sortProviderOfferings } from '@/lib/providers/limits';
import { getProvidersConfig } from '@/lib/providers/types';
import type { LeaderboardModel, ProviderOffering } from '@/lib/supabase/types';

export const revalidate = 21600;

function pickBestAlwaysFreeProvider(model: LeaderboardModel): ProviderOffering | undefined {
  const sorted = sortProviderOfferings(model.providers);
  return sorted.find((p) => p.tier_type === 'always_free') ?? sorted[0];
}

export default async function HomePage() {
  const { models, latestSync, recentPulse, isDemoData } = await getLeaderboardData();
  const providersConfig = getProvidersConfig();
  const providerCount = Object.keys(providersConfig).length;

  const alwaysFreeRanked = [...models]
    .filter((m) => m.providers.some((p) => p.tier_type === 'always_free'))
    .sort((a, b) => (b.freebench_score ?? -1) - (a.freebench_score ?? -1));
  const topModel =
    alwaysFreeRanked.find((m) => m.benchmark_coverage >= 2) ??
    alwaysFreeRanked[0] ??
    models[0];
  const topModelProvider = topModel ? pickBestAlwaysFreeProvider(topModel) : undefined;

  const agenticRanked = [...models]
    .filter(
      (m) =>
        m.agentic_coding_score !== null &&
        m.providers.some((p) => p.tier_type === 'always_free')
    )
    .sort((a, b) => (b.agentic_coding_score ?? 0) - (a.agentic_coding_score ?? 0));
  const topAgentic =
    agenticRanked.find((m) => m.benchmark_coverage >= 2) ?? agenticRanked[0];
  const topAgenticProvider = topAgentic ? pickBestAlwaysFreeProvider(topAgentic) : undefined;

  const latestPulseItem = recentPulse[0];
  const siteUrl = process.env.SITE_URL?.trim() || 'https://freebench.dev';

  const datasetJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'FreeBench Free LLM Leaderboard',
    description: `Live availability and independent benchmark scores (Epoch AI ECI, LiveBench, BFCL) across ${providerCount} zero-cost LLM API providers.`,
    url: siteUrl,
    license: 'https://opensource.org/licenses/MIT',
    dateModified: latestSync?.completed_at ?? new Date().toISOString(),
  };

  return (
    <div className="space-y-4">
      <JsonLd data={datasetJsonLd} />

      {/* Compact Above-the-Fold Hero */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900/90 via-zinc-950 to-zinc-950 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 font-mono text-[11px] text-emerald-300">
            <Sparkles className="h-3 w-3" />
            <span>
              {isDemoData
                ? 'Seed Snapshot Mode'
                : `Updated ${formatRelativeTime(latestSync?.completed_at ?? latestSync?.started_at)}`}{' '}
              · {providerCount} Providers · 3 Benchmarks
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {TASK_DEFINITIONS.slice(0, 5).map((task) => (
              <Link
                key={task.slug}
                href={`/best/${task.slug}`}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-[11px] text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
              >
                <span>{task.shortLabel}</span>
                <ArrowRight className="h-2.5 w-2.5 opacity-60" />
              </Link>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 lg:items-center">
          <div className="space-y-1 lg:col-span-2">
            <h1 className="text-xl font-bold tracking-tight text-zinc-50 sm:text-2xl">
              What is the best free LLM you can use right now?
            </h1>
            <p className="max-w-2xl text-xs leading-relaxed text-zinc-400 sm:text-sm">
              Verified free-tier APIs across {providerCount} providers ranked by Epoch AI,
              LiveBench, and BFCL — with one-click agent snippets and always-free filters.
            </p>
          </div>

          {/* 10-Second Instant Answer Cards */}
          <div className="grid grid-cols-2 gap-2.5">
            {topModel ? (
              <Link
                href={`/models/${encodeURIComponent(topModel.canonical_id)}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/75 p-3 transition-colors hover:border-emerald-500/50"
              >
                <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                  #1 Always-Free
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-zinc-100">
                  {topModel.display_name}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
                  {topModel.freebench_score?.toFixed(1) ?? '—'} ·{' '}
                  {topModelProvider
                    ? providersConfig[topModelProvider.provider_slug].display_name.replace(
                        ' (Free)',
                        ''
                      )
                    : 'Live'}
                </div>
              </Link>
            ) : null}

            {topAgentic ? (
              <Link
                href={`/models/${encodeURIComponent(topAgentic.canonical_id)}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/75 p-3 transition-colors hover:border-cyan-500/50"
              >
                <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-cyan-400">
                  <Terminal className="h-3 w-3" />
                  <span>#1 Agentic Code</span>
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-zinc-100">
                  {topAgentic.display_name}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
                  {topAgentic.agentic_coding_score?.toFixed(1) ?? '—'} ·{' '}
                  {topAgenticProvider
                    ? providersConfig[topAgenticProvider.provider_slug].display_name.replace(
                        ' (Free)',
                        ''
                      )
                    : 'Live'}
                </div>
              </Link>
            ) : null}
          </div>
        </div>

        {/* Slim 1-line radar teaser */}
        {latestPulseItem ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-2 text-xs">
            <a
              href={latestPulseItem.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-2 text-zinc-300 hover:text-emerald-300"
            >
              <Radio className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span className="shrink-0 font-mono text-[11px] text-emerald-400">
                [{latestPulseItem.source_name}]
              </span>
              <span className="truncate">{latestPulseItem.title}</span>
            </a>
            <Link
              href="/pulse"
              className="shrink-0 font-mono text-[11px] text-zinc-400 hover:text-emerald-300"
            >
              Pulse & X watchlist →
            </Link>
          </div>
        ) : null}
      </section>

      <SponsorSlot />

      <Suspense
        fallback={
          <div className="h-96 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
        }
      >
        <LeaderboardClient models={models} />
      </Suspense>

      {/* Full Model Pulse & Agent Radar Grid below the leaderboard */}
      {recentPulse.length > 0 ? (
        <section
          aria-label="Live Model Pulse"
          className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-xs font-semibold text-zinc-200">
              <Radio className="h-3.5 w-3.5 text-emerald-400" />
              <span>Model Pulse & Agent Radar</span>
            </div>
            <Link
              href="/pulse"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              <span>All updates & X watchlist</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            {recentPulse.slice(0, 4).map((item) => (
              <a
                key={item.url}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-2.5 transition-colors hover:border-zinc-700"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-zinc-400">
                  <span className="truncate text-emerald-400">{item.source_name}</span>
                  <span>{formatRelativeTime(item.published_at)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs font-medium text-zinc-200">{item.title}</p>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
