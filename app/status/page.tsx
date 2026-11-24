import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { UnmappedQueue } from '@/components/status/UnmappedQueue';
import { getStatusPageData } from '@/lib/data/queries';
import { formatRelativeTime } from '@/lib/format';
import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';

export const revalidate = 21600;

export const metadata: Metadata = {
  title: 'Sync Health & Unmapped Entities Queue',
  description:
    'Live operational status of FreeBench 6-hour provider pollers, benchmark ingestors, sync run history, and unmapped model ID queue.',
};

export default async function StatusPage() {
  const { syncRuns, unmappedEntities, providerModelCounts, isDemoData } =
    await getStatusPageData();
  const providersConfig = getProvidersConfig();
  const providerSlugs = Object.keys(providersConfig) as ProviderSlug[];
  const latestRun = syncRuns[0] ?? null;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            Sync Health & Ingestion Pipeline
          </h1>
          <p className="text-sm text-zinc-400">
            Non-destructive 6-hour sync runs: failed providers retain last-known-good availability
            and log diagnostics below.
          </p>
        </div>

        {isDemoData ? (
          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-xs text-amber-300">
            Seed Snapshot Mode
          </span>
        ) : null}
      </section>

      {/* Provider Health Grid */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">
          Provider Catalog Status ({providerSlugs.length})
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {providerSlugs.map((slug) => {
            const cfg = providersConfig[slug];
            const count = providerModelCounts[slug] ?? 0;
            const latestError = latestRun?.error_log.find((e) => e.provider === slug)?.error;

            return (
              <Link
                key={slug}
                href={`/providers/${slug}`}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{cfg.display_name}</span>
                  {latestError ? (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )}
                </div>
                <div className="mt-2 font-mono text-xs text-zinc-300">
                  {count} active free model{count === 1 ? '' : 's'}
                </div>
                <div className="mt-1 font-mono text-[11px] text-zinc-500">
                  {cfg.rpm_limit} · {cfg.rpd_limit}
                </div>
                {latestError ? (
                  <p className="mt-2 line-clamp-2 font-mono text-[11px] text-amber-300">
                    {latestError}
                  </p>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Recent Sync Runs */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">Recent Sync Runs</h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full min-w-[700px] border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/70 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Providers OK / Err</th>
                <th className="px-4 py-3">Active Offerings</th>
                <th className="px-4 py-3">Benchmarks</th>
                <th className="px-4 py-3">Notes / Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {syncRuns.map((run) => (
                <tr key={run.id}>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px] ${
                        run.status === 'success'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : run.status === 'partial'
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      <span>{run.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                    {formatRelativeTime(run.started_at)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                    {run.providers_succeeded} / {run.providers_failed}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                    {run.models_active}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                    {run.benchmarks_updated}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-400">
                    {run.error_log.length === 0
                      ? 'Clean run'
                      : run.error_log
                          .map((e) => `${e.provider ?? e.source ?? 'sync'}: ${e.error}`)
                          .join(' | ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <UnmappedQueue entities={unmappedEntities} />
    </div>
  );
}
