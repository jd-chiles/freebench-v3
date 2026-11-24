'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Link2, PanelRightOpen, Plus, X } from 'lucide-react';
import { ProviderBadge } from '@/components/ProviderBadge';
import { ScoreBar } from '@/components/ScoreBar';
import { SessionViabilityBadge } from '@/components/SessionViabilityBadge';
import { ModelDetailDrawer } from '@/components/leaderboard/ModelDetailDrawer';
import { formatContextWindow, formatScore } from '@/lib/format';
import {
  getBestModelViability,
  resolveEffectiveLimits,
  sortProviderOfferings,
} from '@/lib/providers/limits';
import { getProvidersConfig } from '@/lib/providers/types';
import type { LeaderboardModel } from '@/lib/supabase/types';

interface CompareClientProps {
  allModels: LeaderboardModel[];
  initialIds: string[];
}

function getWinningModelIds(
  models: LeaderboardModel[],
  getter: (m: LeaderboardModel) => number | null | undefined
): Set<string> {
  if (models.length < 2) return new Set();
  const entries = models
    .map((m) => ({ id: m.canonical_id, value: getter(m) }))
    .filter((item): item is { id: string; value: number } => typeof item.value === 'number' && Number.isFinite(item.value));

  if (entries.length === 0) return new Set();
  const maxVal = Math.max(...entries.map((e) => e.value));
  const minVal = Math.min(...entries.map((e) => e.value));
  if (entries.length === models.length && maxVal === minVal) return new Set();

  return new Set(entries.filter((e) => e.value === maxVal).map((e) => e.id));
}

/**
 * Interactive side-by-side comparison matrix with URL persistence, per-row winner
 * highlights, rate-limit viability rows, and inline Use This Model snippet drawer.
 */
export function CompareClient({ allModels, initialIds }: CompareClientProps) {
  const defaultIds = useMemo(() => {
    const valid = initialIds.filter((id) => allModels.some((m) => m.canonical_id === id));
    if (valid.length >= 2) return valid.slice(0, 4);
    if (valid.length === 1) {
      const second = allModels.find((m) => m.canonical_id !== valid[0]);
      return second ? [valid[0]!, second.canonical_id] : valid;
    }
    return allModels.slice(0, 3).map((m) => m.canonical_id);
  }, [allModels, initialIds]);

  const [selectedIds, setSelectedIds] = useState<string[]>(defaultIds);
  const [candidateId, setCandidateId] = useState<string>('');
  const [drawerModelId, setDrawerModelId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const query =
      selectedIds.length > 0
        ? `?models=${encodeURIComponent(selectedIds.join(','))}`
        : '';
    window.history.replaceState(null, '', `${window.location.pathname}${query}`);
  }, [selectedIds]);

  const selectedModels = useMemo(
    () =>
      selectedIds
        .map((id) => allModels.find((m) => m.canonical_id === id))
        .filter((m): m is LeaderboardModel => Boolean(m)),
    [allModels, selectedIds]
  );

  const availableToAdd = useMemo(
    () => allModels.filter((m) => !selectedIds.includes(m.canonical_id)),
    [allModels, selectedIds]
  );

  const drawerModel = useMemo(
    () => allModels.find((m) => m.canonical_id === drawerModelId) ?? null,
    [allModels, drawerModelId]
  );

  function addModel(id: string) {
    if (!id || selectedIds.includes(id) || selectedIds.length >= 4) return;
    setSelectedIds((prev) => [...prev, id]);
    setCandidateId('');
  }

  function removeModel(id: string) {
    setSelectedIds((prev) => prev.filter((item) => item !== id));
  }

  async function handleCopyShareLink() {
    try {
      const url = `${window.location.origin}${window.location.pathname}?models=${encodeURIComponent(
        selectedIds.join(',')
      )}`;
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      setLinkCopied(false);
    }
  }

  const providersConfig = getProvidersConfig();

  const metricRows: Array<{
    label: string;
    winners?: Set<string>;
    render: (m: LeaderboardModel) => React.ReactNode;
  }> = [
    {
      label: 'FreeBench Composite',
      winners: getWinningModelIds(selectedModels, (m) => m.freebench_score),
      render: (m) => <ScoreBar value={m.freebench_score} accent="emerald" />,
    },
    {
      label: 'Agentic Coding Score',
      winners: getWinningModelIds(selectedModels, (m) => m.agentic_coding_score),
      render: (m) => <ScoreBar value={m.agentic_coding_score} accent="cyan" />,
    },
    {
      label: 'SWE-bench Verified',
      winners: getWinningModelIds(selectedModels, (m) => m.swebench_verified),
      render: (m) => (
        <span className="font-mono text-xs text-zinc-200">
          {typeof m.swebench_verified === 'number' ? `${formatScore(m.swebench_verified)}%` : '—'}
        </span>
      ),
    },
    {
      label: 'Aider Polyglot',
      winners: getWinningModelIds(selectedModels, (m) => m.aider_polyglot),
      render: (m) => (
        <span className="font-mono text-xs text-zinc-200">
          {typeof m.aider_polyglot === 'number' ? `${formatScore(m.aider_polyglot)}%` : '—'}
        </span>
      ),
    },
    {
      label: 'Epoch ECI (Raw)',
      winners: getWinningModelIds(selectedModels, (m) => m.eci_score),
      render: (m) => <span className="font-mono text-xs">{formatScore(m.eci_score)}</span>,
    },
    {
      label: 'LiveBench Global',
      winners: getWinningModelIds(selectedModels, (m) => m.livebench_global),
      render: (m) => <ScoreBar value={m.livebench_global} accent="cyan" />,
    },
    {
      label: 'LiveBench Coding',
      winners: getWinningModelIds(selectedModels, (m) => m.livebench_coding),
      render: (m) => <ScoreBar value={m.livebench_coding} accent="cyan" />,
    },
    {
      label: 'LiveBench Reasoning',
      winners: getWinningModelIds(selectedModels, (m) => m.livebench_reasoning),
      render: (m) => <ScoreBar value={m.livebench_reasoning} accent="violet" />,
    },
    {
      label: 'LiveBench Math',
      winners: getWinningModelIds(selectedModels, (m) => m.livebench_math),
      render: (m) => <ScoreBar value={m.livebench_math} accent="violet" />,
    },
    {
      label: 'BFCL Tool Calling',
      winners: getWinningModelIds(selectedModels, (m) => m.bfcl_overall),
      render: (m) => <ScoreBar value={m.bfcl_overall} accent="amber" />,
    },
    {
      label: 'Context Window',
      winners: getWinningModelIds(selectedModels, (m) => m.context_window),
      render: (m) => (
        <span className="font-mono text-xs text-zinc-200">
          {formatContextWindow(m.context_window)}
        </span>
      ),
    },
    {
      label: 'Best Always-Free Limit & Viability',
      render: (m) => {
        const best = getBestModelViability(m.providers);
        if (!best) return <span className="font-mono text-xs text-zinc-400">—</span>;
        const limits = resolveEffectiveLimits(best.offering);
        const cfg = providersConfig[best.offering.provider_slug];
        return (
          <div className="space-y-1">
            <SessionViabilityBadge viability={best.viability} compact />
            <div className="font-mono text-[11px] text-zinc-300">
              {cfg.display_name.replace(' (Free)', '')}: {limits.rpmLabel} · {limits.rpdLabel}
            </div>
          </div>
        );
      },
    },
    {
      label: 'Tool Calling / Vision',
      render: (m) => (
        <span className="font-mono text-xs text-zinc-300">
          {m.supports_tools ? 'Tools ✓' : 'Tools ✗'} · {m.supports_vision ? 'Vision ✓' : 'Vision —'}
        </span>
      ),
    },
    {
      label: 'Open Weights',
      render: (m) => (
        <span className="font-mono text-xs text-zinc-300">
          {m.is_open_weights === true ? 'Yes' : m.is_open_weights === false ? 'Proprietary' : '—'}
        </span>
      ),
    },
    {
      label: 'Active Free Providers',
      render: (m) => (
        <div className="flex flex-wrap gap-1">
          {sortProviderOfferings(m.providers).map((p) => (
            <ProviderBadge
              key={`${p.provider_slug}-${p.provider_model_id}`}
              offering={p}
              compact
            />
          ))}
        </div>
      ),
    },
    {
      label: 'Quick Connect',
      render: (m) => (
        <button
          type="button"
          onClick={() => setDrawerModelId(m.canonical_id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          <span>Use This Model</span>
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Add model + share link bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            disabled={selectedIds.length >= 4}
            aria-label="Add model to comparison"
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">
              {selectedIds.length >= 4 ? 'Max 4 models selected' : 'Select a model to add...'}
            </option>
            {availableToAdd.map((m) => (
              <option key={m.canonical_id} value={m.canonical_id}>
                {m.display_name} ({formatScore(m.freebench_score)})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => addModel(candidateId)}
            disabled={!candidateId || selectedIds.length >= 4}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Model</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopyShareLink}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-200 hover:border-emerald-500/50 hover:text-emerald-300"
        >
          {linkCopied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-300">Link Copied</span>
            </>
          ) : (
            <>
              <Link2 className="h-3.5 w-3.5" />
              <span>Copy Share Link</span>
            </>
          )}
        </button>
      </div>

      {/* Comparison Matrix */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
        <table className="w-full min-w-[740px] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/70">
              <th className="w-52 px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                Metric
              </th>
              {selectedModels.map((model) => (
                <th key={model.canonical_id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/models/${encodeURIComponent(model.canonical_id)}`}
                      className="text-sm font-semibold text-zinc-100 hover:text-emerald-400"
                    >
                      {model.display_name}
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeModel(model.canonical_id)}
                      aria-label={`Remove ${model.display_name}`}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {metricRows.map((row) => (
              <tr key={row.label} className="hover:bg-zinc-900/60">
                <td className="px-4 py-3 font-mono text-xs text-zinc-400">{row.label}</td>
                {selectedModels.map((model) => {
                  const isWinner = row.winners?.has(model.canonical_id) ?? false;
                  return (
                    <td
                      key={`${row.label}-${model.canonical_id}`}
                      className={`px-4 py-3 ${isWinner ? 'bg-emerald-500/8' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        {row.render(model)}
                        {isWinner ? (
                          <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-emerald-300">
                            Best
                          </span>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ModelDetailDrawer model={drawerModel} onClose={() => setDrawerModelId(null)} />
    </div>
  );
}
