'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Globe, Infinity as InfinityIcon, Layers, ShieldCheck } from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { ProviderBadge } from '@/components/ProviderBadge';
import { SessionViabilityBadge } from '@/components/SessionViabilityBadge';
import type { SortCategory } from '@/lib/leaderboard/url-state';
import { formatCompactNumber, resolveEffectiveLimits } from '@/lib/providers/limits';
import { KEYLESS_PROVIDERS, loadMyKeys, saveMyKeys } from '@/lib/providers/my-keys';
import { getProvidersConfig } from '@/lib/providers/types';
import { buildFallbackStack, type GeneratedStackConfig } from '@/lib/snippets/stack-generator';
import type { LeaderboardModel, ProviderSlug } from '@/lib/supabase/types';

interface StackBuilderClientProps {
  models: LeaderboardModel[];
}

const TASK_OPTIONS: ReadonlyArray<{ id: SortCategory; label: string }> = [
  { id: 'agentic', label: 'Agentic Coding' },
  { id: 'overall', label: 'General / Overall' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'math', label: 'Math' },
  { id: 'tools', label: 'Tool Use (BFCL)' },
];

const CONTEXT_OPTIONS = [
  { value: 0, label: 'Any context' },
  { value: 32_768, label: '32K+ tokens' },
  { value: 128_000, label: '128K+ tokens' },
  { value: 256_000, label: '256K+ tokens' },
];

const KEYLESS_SET = new Set<ProviderSlug>(KEYLESS_PROVIDERS);

/**
 * Interactive multi-provider free failover stack builder sharing "My Free Keys" state.
 */
export function StackBuilderClient({ models }: StackBuilderClientProps) {
  const providersConfig = getProvidersConfig();
  const allSlugs = Object.keys(providersConfig) as ProviderSlug[];

  const [ownedProviders, setOwnedProviders] = useState<ProviderSlug[]>([...KEYLESS_PROVIDERS]);
  const [task, setTask] = useState<SortCategory>('agentic');
  const [alwaysFreeOnly, setAlwaysFreeOnly] = useState(true);
  const [directApiOnly, setDirectApiOnly] = useState(false);
  const [zeroTrainingOnly, setZeroTrainingOnly] = useState(false);
  const [minContext, setMinContext] = useState(32_768);
  const [activeConfigId, setActiveConfigId] =
    useState<GeneratedStackConfig['id']>('litellm');

  useEffect(() => {
    const saved = loadMyKeys();
    if (saved.length > 0) {
      setOwnedProviders(saved);
    }
  }, []);

  function updateOwnedProviders(next: ProviderSlug[]) {
    setOwnedProviders(next);
    saveMyKeys(next);
  }

  function toggleProvider(slug: ProviderSlug) {
    const exists = ownedProviders.includes(slug);
    const next = exists
      ? ownedProviders.filter((p) => p !== slug)
      : [...ownedProviders, slug];
    updateOwnedProviders(next);
  }

  const stack = useMemo(
    () =>
      buildFallbackStack(models, {
        ownedProviders,
        task,
        alwaysFreeOnly,
        directApiOnly,
        zeroTrainingOnly,
        minContext,
        maxRoutes: 5,
      }),
    [models, ownedProviders, task, alwaysFreeOnly, directApiOnly, zeroTrainingOnly, minContext]
  );

  const activeConfig =
    stack.configs.find((c) => c.id === activeConfigId) ?? stack.configs[0] ?? null;

  function handleDownload(cfg: GeneratedStackConfig) {
    const blob = new Blob([cfg.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = cfg.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const groups: ReadonlyArray<{ title: string; slugs: ProviderSlug[] }> = [
    {
      title: 'Direct API (Keyless)',
      slugs: allSlugs.filter(
        (s) => KEYLESS_SET.has(s) && providersConfig[s].access_mode === 'direct_api'
      ),
    },
    {
      title: 'Direct API (Free Key)',
      slugs: allSlugs.filter(
        (s) =>
          !KEYLESS_SET.has(s) &&
          providersConfig[s].access_mode === 'direct_api' &&
          providersConfig[s].tier_type === 'always_free'
      ),
    },
    {
      title: 'Harness-Only Free',
      slugs: allSlugs.filter((s) => providersConfig[s].access_mode === 'harness_only'),
    },
    {
      title: 'One-Time Trial Credit',
      slugs: allSlugs.filter((s) => providersConfig[s].tier_type === 'trial_credit'),
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left column: Keys & Constraints */}
      <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 lg:col-span-5">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-100">1. Providers You Have Access To</h2>
          </div>
          <div className="flex gap-2 font-mono text-[11px]">
            <button
              type="button"
              onClick={() => updateOwnedProviders([...KEYLESS_PROVIDERS])}
              className="text-cyan-400 hover:underline"
            >
              Keyless (4)
            </button>
            <button
              type="button"
              onClick={() =>
                updateOwnedProviders(
                  allSlugs.filter((s) => providersConfig[s].tier_type === 'always_free')
                )
              }
              className="text-emerald-400 hover:underline"
            >
              All Always-Free
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                {group.title}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {group.slugs.map((slug) => {
                  const cfg = providersConfig[slug];
                  const checked = ownedProviders.includes(slug);
                  const isTrial = cfg.tier_type === 'trial_credit';
                  return (
                    <label
                      key={slug}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                        checked
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-zinc-100'
                          : isTrial
                            ? 'border-dashed border-amber-500/35 bg-zinc-950/60 text-zinc-300 hover:border-amber-400/60'
                            : 'border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProvider(slug)}
                          className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-emerald-500"
                        />
                        <span className="truncate">
                          {cfg.display_name.replace(' (Free)', '')}
                        </span>
                      </span>
                      {isTrial ? (
                        <span className="font-mono text-[9px] uppercase text-amber-300">
                          Credit
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Task & Guardrails */}
        <div className="space-y-3 border-t border-zinc-800 pt-4">
          <h2 className="text-sm font-semibold text-zinc-100">2. Workload & Guardrails</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-zinc-400">
              <span className="block font-mono text-[11px]">Primary Task</span>
              <select
                value={task}
                onChange={(e) => setTask(e.target.value as SortCategory)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100"
              >
                {TASK_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs text-zinc-400">
              <span className="block font-mono text-[11px]">Minimum Context</span>
              <select
                value={minContext}
                onChange={(e) => setMinContext(Number(e.target.value))}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100"
              >
                {CONTEXT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAlwaysFreeOnly((prev) => !prev)}
              aria-pressed={alwaysFreeOnly}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                alwaysFreeOnly
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300'
              }`}
            >
              <InfinityIcon className="h-3.5 w-3.5" />
              <span>Always Free Only</span>
            </button>

            <button
              type="button"
              onClick={() => setDirectApiOnly((prev) => !prev)}
              aria-pressed={directApiOnly}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                directApiOnly
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>Direct API Only</span>
            </button>

            <button
              type="button"
              onClick={() => setZeroTrainingOnly((prev) => !prev)}
              aria-pressed={zeroTrainingOnly}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                zeroTrainingOnly
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Zero Data Training</span>
            </button>
          </div>
        </div>
      </section>

      {/* Right column: Failover Chain + Exportable Configs */}
      <section className="space-y-4 lg:col-span-7">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-3">
            <h2 className="text-sm font-semibold text-zinc-100">
              Recommended Failover Chain ({stack.routes.length} routes)
            </h2>
            {stack.smallRoute ? (
              <span className="font-mono text-[11px] text-zinc-400">
                Small/fast route:{' '}
                <strong className="text-zinc-200">{stack.smallRoute.displayName}</strong>
              </span>
            ) : null}
          </div>

          {stack.routes.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-400">
              No models satisfy all current constraints. Try selecting more providers, disabling Zero
              Data Training, or lowering minimum context.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {stack.routes.map((route, idx) => {
                const limits = resolveEffectiveLimits(route.offering);
                return (
                  <div
                    key={`${route.offering.provider_slug}-${route.offering.provider_model_id}-${idx}`}
                    className="flex flex-col justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                          {idx === 0 ? 'Primary' : `Fallback #${idx}`}
                        </span>
                        <Link
                          href={`/models/${encodeURIComponent(route.canonicalId)}`}
                          className="text-sm font-semibold text-zinc-100 hover:text-emerald-400"
                        >
                          {route.displayName}
                        </Link>
                        {route.score !== null ? (
                          <span className="font-mono text-xs text-zinc-300">
                            ({route.score.toFixed(1)})
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ProviderBadge offering={route.offering} compact />
                        <SessionViabilityBadge viability={route.viability} compact />
                        <span className="font-mono text-[11px] text-zinc-400">
                          {limits.rpmLabel} · {limits.rpdLabel}
                          {limits.tpmInt !== null
                            ? ` · ${formatCompactNumber(limits.tpmInt)} TPM`
                            : ''}
                        </span>
                      </div>
                    </div>

                    <code className="shrink-0 font-mono text-[11px] text-zinc-300">
                      {route.offering.provider_model_id}
                    </code>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {activeConfig ? (
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
              <div className="flex flex-wrap gap-1.5">
                {stack.configs.map((cfg) => (
                  <button
                    key={cfg.id}
                    type="button"
                    onClick={() => setActiveConfigId(cfg.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeConfig.id === cfg.id
                        ? 'bg-emerald-500 font-semibold text-zinc-950'
                        : 'bg-zinc-950 text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <CopyButton text={activeConfig.code} label={`Copy ${activeConfig.filename}`} />
                <button
                  type="button"
                  onClick={() => handleDownload(activeConfig)}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <Download className="h-3 w-3" />
                  <span>{activeConfig.filename}</span>
                </button>
              </div>
            </div>

            <pre className="max-h-96 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">
              <code>{activeConfig.code}</code>
            </pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
