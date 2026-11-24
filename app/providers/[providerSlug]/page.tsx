import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { ScoreBar } from '@/components/ScoreBar';
import { SnippetPanel } from '@/components/SnippetPanel';
import { getProviderPageData } from '@/lib/data/queries';
import { formatContextWindow } from '@/lib/format';
import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';

export const revalidate = 21600;

export function generateStaticParams() {
  const slugs = Object.keys(getProvidersConfig()) as ProviderSlug[];
  return slugs.map((providerSlug) => ({ providerSlug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ providerSlug: string }>;
}): Promise<Metadata> {
  const { providerSlug } = await params;
  const configMap = getProvidersConfig();
  if (!(providerSlug in configMap)) return {};
  const cfg = configMap[providerSlug as ProviderSlug];

  return {
    title: `${cfg.display_name} Free Models, Rate Limits & Benchmarks`,
    description: `All live free-tier LLMs on ${cfg.display_name} (${cfg.rpm_limit}, ${cfg.rpd_limit}), ranked by Epoch AI, LiveBench, and BFCL.`,
  };
}

export default async function ProviderPage({
  params,
}: {
  params: Promise<{ providerSlug: string }>;
}) {
  const { providerSlug } = await params;
  const configMap = getProvidersConfig();
  if (!(providerSlug in configMap)) notFound();

  const slug = providerSlug as ProviderSlug;
  const cfg = configMap[slug];
  const { models } = await getProviderPageData(slug);

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Leaderboard</span>
      </Link>

      <section className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold text-zinc-50">{cfg.display_name} Free Tier</h1>
            {cfg.tier_type === 'trial_credit' ? (
              <span className="rounded border border-dashed border-amber-500/50 bg-amber-500/15 px-2 py-0.5 font-mono text-xs text-amber-200">
                One-Time Credit
              </span>
            ) : (
              <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-xs text-emerald-300">
                Always Free
              </span>
            )}
            {cfg.access_mode === 'harness_only' ? (
              <span className="rounded border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 font-mono text-xs text-violet-200">
                Harness-Only ({cfg.harness_name ?? cfg.display_name})
              </span>
            ) : (
              <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
                Direct API Endpoint
              </span>
            )}
            {cfg.trains_on_data ? (
              <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 font-mono text-xs text-rose-300">
                <ShieldAlert className="h-3.5 w-3.5" /> May train on free prompts
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-xs text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" /> Zero data training
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-zinc-400">
            Limits: <span className="text-zinc-200">{cfg.rpm_limit}</span> ·{' '}
            <span className="text-zinc-200">{cfg.rpd_limit}</span> · No credit card required
          </p>
          {cfg.tier_note ? (
            <p className="text-xs text-zinc-300">{cfg.tier_note}</p>
          ) : null}
          {cfg.privacy_note ? (
            <p className="text-xs text-zinc-400">{cfg.privacy_note}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <a
            href={`/go/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            <span>Get Free API Key</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {cfg.upgrade_url ? (
            <a
              href={cfg.upgrade_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs font-medium text-zinc-200 hover:border-zinc-600"
            >
              <span>Need Higher Limits?</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
        <table className="w-full min-w-[740px] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/70 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Canonical Model</th>
              <th className="px-4 py-3">Provider Model ID</th>
              <th className="px-4 py-3">Composite</th>
              <th className="px-4 py-3">Agentic</th>
              <th className="px-4 py-3">Context</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {models.map((model, idx) => {
              const offering = model.providers.find((p) => p.provider_slug === slug);
              return (
                <tr key={model.canonical_id} className="hover:bg-zinc-900/80">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/models/${encodeURIComponent(model.canonical_id)}`}
                      className="text-sm font-semibold text-zinc-100 hover:text-emerald-400"
                    >
                      {model.display_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                    {offering ? (
                      <div className="flex items-center gap-2">
                        <span>{offering.provider_model_id}</span>
                        <CopyButton text={offering.provider_model_id} />
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBar value={model.freebench_score} accent="emerald" />
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBar value={model.agentic_coding_score} accent="cyan" />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                    {formatContextWindow(offering?.context_window ?? model.context_window)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {models[0] ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-zinc-100">
            Quick-Start Snippet ({models[0].display_name})
          </h2>
          <SnippetPanel
            providers={models[0].providers.filter((p) => p.provider_slug === slug)}
            canonicalId={models[0].canonical_id}
          />
        </section>
      ) : null}
    </div>
  );
}
