import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Eye, GitCompare, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { EndpointHealthBadge } from '@/components/EndpointHealthBadge';
import { JsonLd } from '@/components/JsonLd';
import { PaidEscapeHatchCard } from '@/components/PaidEscapeHatchCard';
import { ResetCountdown } from '@/components/ResetCountdown';
import { ScoreBar } from '@/components/ScoreBar';
import { SessionViabilityBadge } from '@/components/SessionViabilityBadge';
import { SnippetPanel } from '@/components/SnippetPanel';
import { getModelById } from '@/lib/data/queries';
import { formatContextWindow, formatRelativeTime, formatScore } from '@/lib/format';
import {
  computeSessionViability,
  formatCompactNumber,
  resolveEffectiveLimits,
  sortProviderOfferings,
} from '@/lib/providers/limits';
import { getProvidersConfig } from '@/lib/providers/types';

export const revalidate = 21600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ canonicalId: string }>;
}): Promise<Metadata> {
  const { canonicalId } = await params;
  const { model } = await getModelById(canonicalId);

  if (!model) {
    return { title: 'Model Not Found' };
  }

  const providerNames = model.providers.map((p) => p.provider_slug).join(', ');
  return {
    title: `${model.display_name} — Free API Providers, Limits & Benchmarks`,
    description: `Use ${model.display_name} free via ${providerNames}. FreeBench Score ${formatScore(
      model.freebench_score
    )}, context ${formatContextWindow(model.context_window)}, live RPM/RPD limits & code snippets.`,
  };
}

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ canonicalId: string }>;
}) {
  const { canonicalId } = await params;
  const { model, latestSync } = await getModelById(canonicalId);
  if (!model) notFound();

  const providersConfig = getProvidersConfig();
  const siteUrl = process.env.SITE_URL?.trim() || 'https://freebench.dev';

  const appJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: model.display_name,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Cloud API',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    url: `${siteUrl}/models/${encodeURIComponent(model.canonical_id)}`,
  };

  return (
    <div className="space-y-6">
      <JsonLd data={appJsonLd} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Leaderboard</span>
        </Link>

        <Link
          href={`/compare?models=${encodeURIComponent(model.canonical_id)}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-emerald-500/40"
        >
          <GitCompare className="h-3.5 w-3.5" />
          <span>Compare Model</span>
        </Link>
      </div>

      {/* Model Header */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-zinc-50 sm:text-3xl">{model.display_name}</h1>
              {model.is_open_weights ? (
                <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300">
                  Open Weights
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-zinc-400">
              <span>{model.canonical_id}</span>
              {model.family ? <span>· Family: {model.family}</span> : null}
              {model.parameter_count ? <span>· Params: {model.parameter_count}</span> : null}
              <span>· Context: {formatContextWindow(model.context_window)}</span>
              {model.supports_tools ? (
                <span className="inline-flex items-center gap-1 text-cyan-300">
                  <Wrench className="h-3.5 w-3.5" /> Tool Calling
                </span>
              ) : null}
              {model.supports_vision ? (
                <span className="inline-flex items-center gap-1 text-violet-300">
                  <Eye className="h-3.5 w-3.5" /> Vision
                </span>
              ) : null}
            </div>
          </div>

          <div className="text-right font-mono text-xs text-zinc-500">
            <div>Coverage: {model.benchmark_coverage}/3 pillars</div>
            <div>
              Synced {formatRelativeTime(latestSync?.completed_at ?? model.updated_at)}
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="text-[11px] text-zinc-400">FreeBench Composite</div>
            <div className="mt-1">
              <ScoreBar value={model.freebench_score} accent="emerald" />
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="text-[11px] text-zinc-400">Agentic Coding</div>
            <div className="mt-1">
              <ScoreBar value={model.agentic_coding_score} accent="cyan" />
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="text-[11px] text-zinc-400">LiveBench Global</div>
            <div className="mt-1">
              <ScoreBar value={model.livebench_global} accent="cyan" />
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="text-[11px] text-zinc-400">BFCL Tool Use</div>
            <div className="mt-1">
              <ScoreBar value={model.bfcl_overall} accent="amber" />
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="text-[11px] text-zinc-400">Epoch ECI</div>
            <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
              {formatScore(model.eci_score)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="text-[11px] text-zinc-400">LiveBench Coding</div>
            <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
              {formatScore(model.livebench_coding)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="text-[11px] text-zinc-400">LiveBench Reasoning</div>
            <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
              {formatScore(model.livebench_reasoning)}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
            <div className="text-[11px] text-zinc-400">LiveBench Math</div>
            <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
              {formatScore(model.livebench_math)}
            </div>
          </div>
          {typeof model.swebench_verified === 'number' ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="text-[11px] text-zinc-400">SWE-bench Verified</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                {formatScore(model.swebench_verified)}%
              </div>
            </div>
          ) : null}
          {typeof model.aider_polyglot === 'number' ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="text-[11px] text-zinc-400">Aider Polyglot</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                {formatScore(model.aider_polyglot)}%
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Free Providers Table */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-zinc-100">
          Where to Run {model.display_name} for Free ({model.providers.length})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full min-w-[780px] border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/70 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Exact API Model ID</th>
                <th className="px-4 py-3">Limits & Viability</th>
                <th className="px-4 py-3">Privacy</th>
                <th className="px-4 py-3">Context</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {sortProviderOfferings(model.providers).map((offering) => {
                const cfg = providersConfig[offering.provider_slug];
                const limits = resolveEffectiveLimits(offering);
                const viability = computeSessionViability(offering);
                return (
                  <tr key={`${offering.provider_slug}-${offering.provider_model_id}`}>
                    <td className="px-4 py-3 text-xs font-semibold text-zinc-100">
                      <Link
                        href={`/providers/${offering.provider_slug}`}
                        className="hover:text-emerald-400"
                      >
                        {cfg.display_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {offering.tier_type === 'trial_credit' ? (
                          <span
                            title={cfg.tier_note}
                            className="inline-block rounded border border-dashed border-amber-500/50 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] text-amber-200"
                          >
                            One-Time Credit
                          </span>
                        ) : (
                          <span
                            title={cfg.tier_note}
                            className="inline-block rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-300"
                          >
                            Always Free
                          </span>
                        )}
                        {cfg.access_mode === 'harness_only' ? (
                          <span className="inline-block rounded border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] text-violet-200">
                            Harness-Only ({cfg.harness_name ?? cfg.display_name})
                          </span>
                        ) : (
                          <span className="inline-block rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                            Direct API
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                      <div className="flex items-center gap-2">
                        <span>{offering.provider_model_id}</span>
                        <CopyButton text={offering.provider_model_id} />
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <SessionViabilityBadge viability={viability} compact />
                          <ResetCountdown
                            resetTz={limits.quotaResetTz}
                            fallbackLabel={limits.quotaResetLabel}
                          />
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          {limits.rpmLabel} · {limits.rpdLabel}
                          {limits.tpmInt !== null ? ` · ${formatCompactNumber(limits.tpmInt)} TPM` : ''}
                          {limits.tpdInt !== null ? ` · ${formatCompactNumber(limits.tpdInt)} TPD` : ''}
                        </div>
                        <EndpointHealthBadge offering={offering} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {offering.trains_on_data ? (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 font-mono text-[11px] text-rose-300">
                          <ShieldAlert className="h-3 w-3" /> Trains on data
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                          <ShieldCheck className="h-3 w-3" /> Zero training
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                      {formatContextWindow(offering.context_window ?? model.context_window)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/go/${offering.provider_slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:text-emerald-300"
                      >
                        <span>Get Key</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <PaidEscapeHatchCard canonicalId={model.canonical_id} displayName={model.display_name} />

      <SnippetPanel providers={model.providers} canonicalId={model.canonical_id} />
    </div>
  );
}
