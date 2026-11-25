'use client';

import Link from 'next/link';
import { ArrowUpDown, Bookmark, Eye, PanelRightOpen, Wrench } from 'lucide-react';
import { MethodologyModal } from '@/components/MethodologyModal';
import { ProviderBadge } from '@/components/ProviderBadge';
import { ScoreBar } from '@/components/ScoreBar';
import { SessionViabilityBadge } from '@/components/SessionViabilityBadge';
import { formatContextWindow } from '@/lib/format';
import type { SortCategory, SortKey } from '@/lib/leaderboard/url-state';
import { getBestModelViability, sortProviderOfferings } from '@/lib/providers/limits';
import type { LeaderboardModel } from '@/lib/supabase/types';

export type { SortKey };

interface LeaderboardTableProps {
  models: LeaderboardModel[];
  category: SortCategory;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  onSelectModel: (model: LeaderboardModel) => void;
  compareIds: string[];
  onToggleCompare: (canonicalId: string) => void;
  pinnedIds?: Set<string>;
  onTogglePin?: (model: LeaderboardModel) => void;
  onResetFilters?: () => void;
}

function CoverageDots({ model }: { model: LeaderboardModel }) {
  const pillars = [
    `ECI ${model.eci_score !== null ? '✓' : '—'}`,
    `LiveBench ${model.livebench_global !== null ? '✓' : '—'}`,
    `BFCL ${model.bfcl_overall !== null ? '✓' : '—'}`,
  ];
  const tooltip = `${model.benchmark_coverage}/3 composite pillars: ${pillars.join(' · ')}`;

  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center gap-0.5 font-mono text-[10px] text-zinc-400"
    >
      {[1, 2, 3].map((idx) => (
        <span
          key={idx}
          className={`h-1.5 w-1.5 rounded-full ${
            idx <= model.benchmark_coverage ? 'bg-emerald-400' : 'bg-zinc-800'
          }`}
        />
      ))}
    </span>
  );
}

/**
 * Renders the primary FreeBench model ranking as an accessible desktop table (`md+`)
 * and responsive mobile cards (`<md`) with session viability and sorted provider badges.
 */
export function LeaderboardTable({
  models,
  category,
  sortKey,
  sortAsc,
  onSort,
  onSelectModel,
  compareIds,
  onToggleCompare,
  pinnedIds,
  onTogglePin,
  onResetFilters,
}: LeaderboardTableProps) {
  if (models.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-10 text-center">
        <p className="text-sm font-medium text-zinc-200">No free models match your filters.</p>
        <p className="mt-1 text-xs text-zinc-400">
          Try relaxing the Zero Data Training toggle, My Keys filter, context minimum, or provider
          selection.
        </p>
        {onResetFilters ? (
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-4 inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
          >
            Reset all filters
          </button>
        ) : null}
      </div>
    );
  }

  const getAriaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none';
    return sortAsc ? 'ascending' : 'descending';
  };

  const renderSortHeader = (label: string, key: SortKey) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className={`inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
        sortKey === key ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-100'
      }`}
    >
      <span>{label}</span>
      <ArrowUpDown className="h-3 w-3" />
      {sortKey === key ? (
        <span className="text-[9px]">{sortAsc ? '↑' : '↓'}</span>
      ) : null}
    </button>
  );

  return (
    <>
      {/* Mobile Card Layout (< md) */}
      <div className="space-y-3 md:hidden">
        {models.map((model, index) => {
          const isChecked = compareIds.includes(model.canonical_id);
          const sortedProviders = sortProviderOfferings(model.providers);
          const bestViability = getBestModelViability(sortedProviders);
          const liveBenchValue =
            category === 'coding'
              ? model.livebench_coding
              : category === 'reasoning'
                ? model.livebench_reasoning
                : category === 'math'
                  ? model.livebench_math
                  : model.livebench_global;

          return (
            <div
              key={model.canonical_id}
              className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-400">#{index + 1}</span>
                    <Link
                      href={`/models/${encodeURIComponent(model.canonical_id)}`}
                      className="truncate text-sm font-semibold text-zinc-100 hover:text-emerald-400"
                    >
                      {model.display_name}
                    </Link>
                    <CoverageDots model={model} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
                    {model.family ? <span>{model.family}</span> : null}
                    <span>· {formatContextWindow(model.context_window)}</span>
                    {bestViability ? (
                      <SessionViabilityBadge viability={bestViability.viability} compact />
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-400">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!isChecked && compareIds.length >= 4}
                      onChange={() => onToggleCompare(model.canonical_id)}
                      aria-label={`Select ${model.display_name} to compare`}
                      className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-emerald-500"
                    />
                    <span>Cmp</span>
                  </label>
                  {onTogglePin ? (
                    <button
                      type="button"
                      onClick={() => onTogglePin(model)}
                      aria-label={`${pinnedIds?.has(model.canonical_id) ? 'Unpin' : 'Pin'} ${model.display_name}`}
                      aria-pressed={pinnedIds?.has(model.canonical_id) ?? false}
                      className={`rounded-md border p-1.5 transition-colors ${
                        pinnedIds?.has(model.canonical_id)
                          ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                          : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-100'
                      }`}
                    >
                      <Bookmark className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onSelectModel(model)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-emerald-500/50"
                  >
                    <PanelRightOpen className="h-3.5 w-3.5" />
                    <span>Inspect</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                <div>
                  <div className="font-mono text-[10px] text-zinc-400">
                    {category === 'agentic' ? 'Agentic' : 'Composite'}
                  </div>
                  <ScoreBar
                    value={
                      category === 'agentic'
                        ? model.agentic_coding_score
                        : model.freebench_score
                    }
                    accent="emerald"
                  />
                </div>
                <div>
                  <div className="font-mono text-[10px] text-zinc-400">
                    {category === 'coding'
                      ? 'Coding'
                      : category === 'reasoning'
                        ? 'Reasoning'
                        : category === 'math'
                          ? 'Math'
                          : 'LiveBench'}
                  </div>
                  <ScoreBar value={liveBenchValue} accent="cyan" />
                </div>
                <div>
                  <div className="font-mono text-[10px] text-zinc-400">BFCL</div>
                  <ScoreBar value={model.bfcl_overall} accent="amber" />
                </div>
              </div>
              {typeof model.fb_eval_score === 'number' ? (
                <div className="flex items-center justify-between rounded-md border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 font-mono text-[11px] text-violet-200">
                  <span>FB-Eval {model.fb_eval_version ?? 'v1'}</span>
                  <span>{model.fb_eval_score.toFixed(1)}</span>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-1.5">
                {sortedProviders.slice(0, 3).map((offering) => (
                  <ProviderBadge
                    key={`${offering.provider_slug}-${offering.provider_model_id}`}
                    offering={offering}
                    compact
                  />
                ))}
                {sortedProviders.length > 3 ? (
                  <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    +{sortedProviders.length - 3}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table (md+) */}
      <div className="hidden overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40 md:block">
        <table className="w-full min-w-[960px] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/70">
              <th className="w-10 px-3 py-3 text-center font-mono text-[11px] text-zinc-400">
                Cmp
              </th>
              <th className="w-10 px-2 py-3 font-mono text-[11px] text-zinc-400">#</th>
              <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                Model
              </th>
              <th className="px-3 py-3" aria-sort={getAriaSort('freebench_score')}>
                <div className="flex items-center gap-2">
                  {renderSortHeader('Composite', 'freebench_score')}
                  <MethodologyModal />
                </div>
              </th>
              {category === 'agentic' ? (
                <th className="px-3 py-3" aria-sort={getAriaSort('agentic_coding_score')}>
                  {renderSortHeader('Agentic', 'agentic_coding_score')}
                </th>
              ) : null}
              <th className="px-3 py-3" aria-sort={getAriaSort('eci_score')}>
                {renderSortHeader('ECI', 'eci_score')}
              </th>
              <th
                className="px-3 py-3"
                aria-sort={getAriaSort(
                  category === 'coding'
                    ? 'livebench_coding'
                    : category === 'reasoning'
                      ? 'livebench_reasoning'
                      : category === 'math'
                        ? 'livebench_math'
                        : 'livebench_global'
                )}
              >
                {category === 'coding'
                  ? renderSortHeader('Coding', 'livebench_coding')
                  : category === 'reasoning'
                    ? renderSortHeader('Reasoning', 'livebench_reasoning')
                    : category === 'math'
                      ? renderSortHeader('Math', 'livebench_math')
                      : renderSortHeader('LiveBench', 'livebench_global')}
              </th>
              <th className="px-3 py-3" aria-sort={getAriaSort('bfcl_overall')}>
                {renderSortHeader('BFCL', 'bfcl_overall')}
              </th>
              <th className="px-3 py-3" aria-sort={getAriaSort('fb_eval_score')}>
                {renderSortHeader('FB-Eval', 'fb_eval_score')}
              </th>
              <th className="px-3 py-3" aria-sort={getAriaSort('context_window')}>
                {renderSortHeader('Context', 'context_window')}
              </th>
              <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                Free Providers & Viability
              </th>
              <th className="w-20 px-3 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                Inspect
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {models.map((model, index) => {
              const isChecked = compareIds.includes(model.canonical_id);
              const sortedProviders = sortProviderOfferings(model.providers);
              const bestViability = getBestModelViability(sortedProviders);
              const liveBenchValue =
                category === 'coding'
                  ? model.livebench_coding
                  : category === 'reasoning'
                    ? model.livebench_reasoning
                    : category === 'math'
                      ? model.livebench_math
                      : model.livebench_global;

              return (
                <tr
                  key={model.canonical_id}
                  onClick={() => onSelectModel(model)}
                  className="group cursor-pointer transition-colors hover:bg-zinc-900/90"
                >
                  <td
                    className="px-3 py-3 text-center"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!isChecked && compareIds.length >= 4}
                      onChange={() => onToggleCompare(model.canonical_id)}
                      aria-label={`Select ${model.display_name} to compare`}
                      className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-emerald-500"
                    />
                  </td>

                  <td className="px-2 py-3 font-mono text-xs tabular-nums text-zinc-400">
                    {index + 1}
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/models/${encodeURIComponent(model.canonical_id)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-semibold text-zinc-100 transition-colors group-hover:text-emerald-400"
                        >
                          {model.display_name}
                        </Link>
                        <CoverageDots model={model} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
                        {model.family ? <span>{model.family}</span> : null}
                        {model.parameter_count ? <span>· {model.parameter_count}</span> : null}
                        {model.is_open_weights ? (
                          <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-200">
                            Open
                          </span>
                        ) : null}
                        {model.supports_tools ? (
                          <Wrench className="h-3 w-3 text-cyan-400" aria-label="Supports tools" />
                        ) : null}
                        {model.supports_vision ? (
                          <Eye className="h-3 w-3 text-violet-400" aria-label="Supports vision" />
                        ) : null}
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    <ScoreBar value={model.freebench_score} accent="emerald" />
                  </td>

                  {category === 'agentic' ? (
                    <td className="px-3 py-3">
                      <ScoreBar value={model.agentic_coding_score} accent="cyan" />
                    </td>
                  ) : null}

                  <td className="px-3 py-3 font-mono text-xs tabular-nums text-zinc-300">
                    {model.eci_score !== null ? model.eci_score.toFixed(1) : '—'}
                  </td>

                  <td className="px-3 py-3">
                    <ScoreBar value={liveBenchValue} accent="cyan" />
                  </td>

                  <td className="px-3 py-3">
                    <ScoreBar value={model.bfcl_overall} accent="amber" />
                  </td>

                  <td className="px-3 py-3 font-mono text-xs tabular-nums">
                    {typeof model.fb_eval_score === 'number' ? (
                      <span
                        title={`FB-Eval ${model.fb_eval_version ?? 'v1'} (Self-Eval): Code ${model.fb_eval_coding?.toFixed(0) ?? '—'} · Tools ${model.fb_eval_tools?.toFixed(0) ?? '—'} · IFEval ${model.fb_eval_if?.toFixed(0) ?? '—'} · Logic ${model.fb_eval_reasoning?.toFixed(0) ?? '—'}`}
                        className="inline-flex items-center rounded border border-violet-500/35 bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-medium text-violet-200"
                      >
                        {model.fb_eval_score.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>

                  <td className="px-3 py-3 font-mono text-xs tabular-nums text-zinc-300">
                    {formatContextWindow(model.context_window)}
                  </td>

                  <td className="px-3 py-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-1">
                        {sortedProviders.slice(0, 3).map((offering) => (
                          <ProviderBadge
                            key={`${offering.provider_slug}-${offering.provider_model_id}`}
                            offering={offering}
                            compact
                          />
                        ))}
                        {sortedProviders.length > 3 ? (
                          <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                            +{sortedProviders.length - 3}
                          </span>
                        ) : null}
                      </div>
                      {bestViability ? (
                        <SessionViabilityBadge viability={bestViability.viability} compact />
                      ) : null}
                    </div>
                  </td>

                  <td
                    className="px-3 py-3 text-right"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {onTogglePin ? (
                        <button
                          type="button"
                          onClick={() => onTogglePin(model)}
                          aria-label={`${pinnedIds?.has(model.canonical_id) ? 'Unpin' : 'Pin'} ${model.display_name}`}
                          aria-pressed={pinnedIds?.has(model.canonical_id) ?? false}
                          title="Pin to My Stack"
                          className={`rounded-md border p-1 transition-colors ${
                            pinnedIds?.has(model.canonical_id)
                              ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                              : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100'
                          }`}
                        >
                          <Bookmark className="h-3 w-3" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onSelectModel(model)}
                        aria-label={`Inspect ${model.display_name}`}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
                      >
                        <PanelRightOpen className="h-3 w-3" />
                        <span>Use</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
