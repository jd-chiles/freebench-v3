import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Terminal } from 'lucide-react';
import { JsonLd } from '@/components/JsonLd';
import { ProviderBadge } from '@/components/ProviderBadge';
import { SnippetPanel } from '@/components/SnippetPanel';
import { SponsorSlot } from '@/components/SponsorSlot';
import { LeaderboardClient } from '@/components/leaderboard/LeaderboardClient';
import {
  filterModelsForTask,
  getAgentPortals,
  getLeaderboardData,
  TASK_DEFINITIONS,
} from '@/lib/data/queries';
import { formatContextWindow, formatRelativeTime, formatScore } from '@/lib/format';
import type { LeaderboardFilterState, SortCategory } from '@/lib/leaderboard/url-state';
import { sortProviderOfferings } from '@/lib/providers/limits';
import { getProvidersConfig } from '@/lib/providers/types';
import type { LeaderboardModel } from '@/lib/supabase/types';

export const revalidate = 21600;

interface TaskViewConfig {
  category: SortCategory;
  initialFilters: Partial<LeaderboardFilterState>;
  primaryMetricLabel: string;
  getPrimaryMetric: (model: LeaderboardModel) => string;
}

function getTaskViewConfig(slug: string): TaskViewConfig {
  switch (slug) {
    case 'agentic-coding':
      return {
        category: 'agentic',
        initialFilters: { toolsOnly: true },
        primaryMetricLabel: 'Agentic',
        getPrimaryMetric: (m) => formatScore(m.agentic_coding_score),
      };
    case 'coding':
      return {
        category: 'coding',
        initialFilters: {},
        primaryMetricLabel: 'LiveBench Coding',
        getPrimaryMetric: (m) => formatScore(m.livebench_coding),
      };
    case 'reasoning':
      return {
        category: 'reasoning',
        initialFilters: {},
        primaryMetricLabel: 'LiveBench Reasoning',
        getPrimaryMetric: (m) => formatScore(m.livebench_reasoning),
      };
    case 'math':
      return {
        category: 'math',
        initialFilters: {},
        primaryMetricLabel: 'LiveBench Math',
        getPrimaryMetric: (m) => formatScore(m.livebench_math),
      };
    case 'tool-calling':
      return {
        category: 'tools',
        initialFilters: { toolsOnly: true },
        primaryMetricLabel: 'BFCL Tool Use',
        getPrimaryMetric: (m) => formatScore(m.bfcl_overall),
      };
    case 'vision':
      return {
        category: 'overall',
        initialFilters: { visionOnly: true },
        primaryMetricLabel: 'Composite',
        getPrimaryMetric: (m) => formatScore(m.freebench_score),
      };
    case 'long-context':
      return {
        category: 'overall',
        initialFilters: { minContext: 128_000 },
        primaryMetricLabel: 'Context',
        getPrimaryMetric: (m) => formatContextWindow(m.context_window),
      };
    case 'always-free':
      return {
        category: 'overall',
        initialFilters: { alwaysFreeOnly: true },
        primaryMetricLabel: 'Composite',
        getPrimaryMetric: (m) => formatScore(m.freebench_score),
      };
    case 'privacy':
      return {
        category: 'overall',
        initialFilters: { zeroTrainingOnly: true },
        primaryMetricLabel: 'Composite',
        getPrimaryMetric: (m) => formatScore(m.freebench_score),
      };
    case 'open-weights':
      return {
        category: 'overall',
        initialFilters: { openWeightsOnly: true },
        primaryMetricLabel: 'Composite',
        getPrimaryMetric: (m) => formatScore(m.freebench_score),
      };
    default:
      return {
        category: 'overall',
        initialFilters: {},
        primaryMetricLabel: 'Composite',
        getPrimaryMetric: (m) => formatScore(m.freebench_score),
      };
  }
}

export function generateStaticParams() {
  return TASK_DEFINITIONS.map((task) => ({ task: task.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ task: string }>;
}): Promise<Metadata> {
  const { task } = await params;
  const def = TASK_DEFINITIONS.find((t) => t.slug === task);
  if (!def) return {};

  return {
    title: def.title,
    description: def.description,
    openGraph: {
      title: def.title,
      description: def.description,
    },
  };
}

export default async function BestTaskPage({
  params,
}: {
  params: Promise<{ task: string }>;
}) {
  const { task } = await params;
  const def = TASK_DEFINITIONS.find((t) => t.slug === task);
  if (!def) notFound();

  const { models, latestSync } = await getLeaderboardData();
  const ranked = filterModelsForTask(models, def.slug);
  const topPick = ranked[0];
  const taskView = getTaskViewConfig(def.slug);
  const agentPortals = def.slug === 'agentic-coding' ? getAgentPortals() : [];
  const siteUrl = process.env.SITE_URL?.trim() || 'https://freebench.dev';

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: def.title,
    itemListElement: ranked.slice(0, 10).map((m, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: m.display_name,
      url: `${siteUrl}/models/${encodeURIComponent(m.canonical_id)}`,
    })),
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: def.heroQuestion,
        acceptedAnswer: {
          '@type': 'Answer',
          text: topPick
            ? `${def.faqAnswerPrefix} Currently #1 is ${topPick.display_name} (available free on ${topPick.providers
                .map((p) => p.provider_slug)
                .join(', ')}).`
            : def.faqAnswerPrefix,
        },
      },
      {
        '@type': 'Question',
        name: 'How often are free-tier LLM availability and limits verified?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: `FreeBench polls all ${Object.keys(getProvidersConfig()).length} free API provider catalogs every 6 hours and automatically soft-deactivates models that drop off free tiers.`,
        },
      },
    ],
  };

  return (
    <div className="space-y-6">
      <JsonLd data={itemListJsonLd} />
      <JsonLd data={faqJsonLd} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Full Leaderboard</span>
        </Link>

        <span className="font-mono text-[11px] text-zinc-400">
          Verified {formatRelativeTime(latestSync?.completed_at ?? latestSync?.started_at)}
        </span>
      </div>

      {/* Header + #1 Answer Card */}
      <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
          {def.title}
        </h1>
        <p className="max-w-3xl text-sm text-zinc-400">{def.description}</p>

        {topPick ? (
          <div className="grid gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 lg:grid-cols-2 lg:items-center">
            <div className="space-y-2">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                Current #1 Free Pick — {def.shortLabel}
              </div>
              <div className="text-xl font-bold text-zinc-50">
                <Link
                  href={`/models/${encodeURIComponent(topPick.canonical_id)}`}
                  className="hover:text-emerald-300"
                >
                  {topPick.display_name}
                </Link>
              </div>
              <div className="flex flex-wrap gap-3 font-mono text-xs text-zinc-300">
                <span>
                  {taskView.primaryMetricLabel}:{' '}
                  <strong className="text-emerald-300">{taskView.getPrimaryMetric(topPick)}</strong>
                </span>
                <span>Composite: {formatScore(topPick.freebench_score)}</span>
                <span>Coding: {formatScore(topPick.livebench_coding)}</span>
                <span>BFCL: {formatScore(topPick.bfcl_overall)}</span>
                <span>Context: {formatContextWindow(topPick.context_window)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {sortProviderOfferings(topPick.providers).map((p) => (
                  <ProviderBadge key={`${p.provider_slug}-${p.provider_model_id}`} offering={p} />
                ))}
              </div>
            </div>

            <SnippetPanel
              providers={sortProviderOfferings(topPick.providers)}
              canonicalId={topPick.canonical_id}
            />
          </div>
        ) : null}
      </section>

      {/* Curated Free Agentic Portals (shown on agentic-coding) */}
      {agentPortals.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-zinc-100">
              Curated Free Agentic Coding Portals & Harnesses
            </h2>
          </div>
          <p className="text-xs text-zinc-400">
            Free coding portals and built-in agent modes (Kilo Code, OpenRouter :free, Nous Portal for
            Hermes Agent, Freebuff, OpenCode Zen) clearly tagged as Always Free vs One-Time Credits.
          </p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {agentPortals.map((portal) => (
              <div
                key={portal.slug}
                className={`flex flex-col justify-between gap-3 rounded-xl p-4 ${
                  portal.tier_type === 'trial_credit'
                    ? 'border border-dashed border-amber-500/40 bg-amber-500/5'
                    : 'border border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-zinc-100">{portal.name}</h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                            portal.tier_type === 'trial_credit'
                              ? 'border border-dashed border-amber-500/50 bg-amber-500/15 text-amber-200'
                              : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          {portal.tier_label}
                        </span>
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                            portal.access_mode === 'harness_only'
                              ? 'border border-violet-500/40 bg-violet-500/15 text-violet-200'
                              : 'bg-zinc-800 text-zinc-300'
                          }`}
                        >
                          {portal.access_mode === 'harness_only'
                            ? `Harness-Only (${portal.harness_name ?? 'Agent'})`
                            : 'Direct API'}
                        </span>
                      </div>
                    </div>
                    <a
                      href={portal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-emerald-400"
                      aria-label={`Visit ${portal.name}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {portal.target_agents.map((agent) => (
                      <span
                        key={agent}
                        className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300"
                      >
                        {agent}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-400">{portal.highlights}</p>
                </div>
                <div className="border-t border-zinc-800/80 pt-2 font-mono text-[11px] text-zinc-300">
                  <div>{portal.limits_note}</div>
                  <div className="mt-0.5 text-zinc-400">{portal.signup_note}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <SponsorSlot />

      {/* Interactive Filtered Leaderboard with Task-Specific Column Sorting & Mobile Cards */}
      <Suspense
        fallback={
          <div className="h-80 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
        }
      >
        <LeaderboardClient
          models={models}
          initialCategory={taskView.category}
          initialFilters={taskView.initialFilters}
          syncUrl={false}
        />
      </Suspense>

      {/* FAQ for SEO & GEO */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
        <h2 className="text-sm font-semibold text-zinc-100">{def.heroQuestion}</h2>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          {def.faqAnswerPrefix}{' '}
          {topPick
            ? `Based on our latest 6-hour sync, ${topPick.display_name} ranks #1 for ${def.shortLabel}.`
            : ''}
        </p>
      </section>
    </div>
  );
}
