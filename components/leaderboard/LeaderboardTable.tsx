'use client';

import Link from 'next/link';
import {
  ArrowUpDown,
  Bookmark,
  Compass,
  Eye,
  PanelRightOpen,
  Wrench,
} from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { EndpointHealthBadge } from '@/components/EndpointHealthBadge';
import { MethodologyModal } from '@/components/MethodologyModal';
import { ProviderBadge } from '@/components/ProviderBadge';
import { ScoreBar } from '@/components/ScoreBar';
import { SessionViabilityBadge } from '@/components/SessionViabilityBadge';
import { formatContextWindow } from '@/lib/format';
import {
  extractBenchmarkSignals,
  getPrimaryLimitsSummary,
  getUnrankedReason,
  isRankedModel,
} from '@/lib/leaderboard/display';
import type { LeaderboardScope, SortCategory, SortKey } from '@/lib/leaderboard/url-state';
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
  scope?: LeaderboardScope;
  onChangeScope?: (scope: LeaderboardScope) => void;
  rankedCount?: number;
  unrankedCount?: number;
  showLegacy?: boolean;
  hiddenLegacyCount?: number;
  onToggleLegacy?: () => void;
  tableViewMode?: 'smart' | 'raw';
  onChangeTableViewMode?: (mode: 'smart' | 'raw') => void;
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

function getCategoryScoreConfig(
  model: LeaderboardModel,
  category: SortCategory
): {
  label: string;
  sortKey: SortKey;
  value: number | null;
  accent: 'emerald' | 'cyan' | 'amber';
} {
  switch (category) {
    case 'agentic':
      return {
        label: 'Agentic',
        sortKey: 'agentic_coding_score',
        value: model.agentic_coding_score,
        accent: 'cyan',
      };
    case 'coding':
      return {
        label: 'Coding',
        sortKey: 'livebench_coding',
        value: model.livebench_coding,
        accent: 'cyan',
      };
    case 'reasoning':
      return {
        label: 'Reasoning',
        sortKey: 'livebench_reasoning',
        value: model.livebench_reasoning,
        accent: 'cyan',
      };
    case 'math':
      return {
        label: 'Math',
        sortKey: 'livebench_math',
        value: model.livebench_math,
        accent: 'cyan',
      };
    case 'tools':
      return {
        label: 'BFCL Tools',
        sortKey: 'bfcl_overall',
        value: model.bfcl_overall,
        accent: 'amber',
      };
    case 'overall':
    default:
      return {
        label: 'Composite',
        sortKey: 'freebench_score',
        value: model.freebench_score,
        accent: 'emerald',
      };
  }
}

function ModelIdentityCell({
  model,
  showUnrankedBadge,
}: {
  model: LeaderboardModel;
  showUnrankedBadge: boolean;
}) {
  const unranked = !isRankedModel(model);
  const reason = unranked ? getUnrankedReason(model) : null;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/models/${encodeURIComponent(model.canonical_id)}`}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-semibold text-zinc-100 transition-colors group-hover:text-emerald-400"
        >
          {model.display_name}
        </Link>
        {!unranked ? (
          <CoverageDots model={model} />
        ) : showUnrankedBadge && reason ? (
          <span
            title={reason.detail}
            className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
          >
            {reason.badge}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
        {model.family ? <span>{model.family}</span> : null}
        {model.parameter_count ? <span>· {model.parameter_count}</span> : null}
        {model.is_open_weights ? (
          <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-200">Open</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Renders the primary FreeBench model ranking as an accessible desktop table (`md+`)
 * and responsive mobile cards (`<md`) with Smart Signal clusters, Stealth & Unranked Radar,
 * inline 1-click model ID copy, session viability, and sorted provider badges.
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
  scope = 'ranked',
  onChangeScope,
  rankedCount,
  unrankedCount,
  showLegacy = false,
  hiddenLegacyCount = 0,
  onToggleLegacy,
  tableViewMode = 'smart',
  onChangeTableViewMode,
}: LeaderboardTableProps) {
  const effectiveRankedCount = rankedCount ?? models.filter(isRankedModel).length;
  const effectiveUnrankedCount = unrankedCount ?? models.length - effectiveRankedCount;
  const totalScopeCount = effectiveRankedCount + effectiveUnrankedCount;

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
      {sortKey === key ? <span className="text-[9px]">{sortAsc ? '↑' : '↓'}</span> : null}
    </button>
  );

  const primaryScoreHeader = getCategoryScoreConfig(
    models[0] ??
      ({
        freebench_score: null,
        agentic_coding_score: null,
        livebench_coding: null,
        livebench_reasoning: null,
        livebench_math: null,
        bfcl_overall: null,
      } as LeaderboardModel),
    category
  );

  const showToolbar = Boolean(onChangeScope || onChangeTableViewMode || onToggleLegacy);

  return (
    <div className="space-y-3">
      {/* Scope & View Mode Toolbar */}
      {showToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5">
          {onChangeScope ? (
            <div
              className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
              role="tablist"
              aria-label="Model ranking scope"
            >
              {(
                [
                  { id: 'ranked', label: `Ranked (${effectiveRankedCount})` },
                  { id: 'unranked', label: `Stealth & Unranked (${effectiveUnrankedCount})` },
                  { id: 'all', label: `All (${totalScopeCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={scope === tab.id}
                  onClick={() => onChangeScope(tab.id)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    scope === tab.id
                      ? 'bg-emerald-500/20 font-semibold text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : (
            <div />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {onToggleLegacy && (hiddenLegacyCount > 0 || showLegacy) ? (
              <button
                type="button"
                onClick={onToggleLegacy}
                aria-pressed={showLegacy}
                className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  showLegacy
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                {showLegacy
                  ? 'Hide legacy / <16K'
                  : `Show legacy (+${hiddenLegacyCount})`}
              </button>
            ) : null}

            {onChangeTableViewMode && scope !== 'unranked' ? (
              <div
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1"
                role="group"
                aria-label="Table column density"
              >
                <button
                  type="button"
                  onClick={() => onChangeTableViewMode('smart')}
                  aria-pressed={tableViewMode === 'smart'}
                  className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
                    tableViewMode === 'smart'
                      ? 'bg-zinc-800 font-semibold text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Smart
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTableViewMode('raw')}
                  aria-pressed={tableViewMode === 'raw'}
                  className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
                    tableViewMode === 'raw'
                      ? 'bg-zinc-800 font-semibold text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Raw Benchmarks
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {models.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-10 text-center">
          <p className="text-sm font-medium text-zinc-200">
            No free models match your filters in this view.
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {scope === 'ranked' && effectiveUnrankedCount > 0
              ? `${effectiveUnrankedCount} stealth or unranked models match your current filters.`
              : 'Try relaxing the Zero Data Training toggle, My Keys filter, context minimum, or provider selection.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {scope === 'ranked' && effectiveUnrankedCount > 0 && onChangeScope ? (
              <button
                type="button"
                onClick={() => onChangeScope('unranked')}
                className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
              >
                View Stealth & Unranked ({effectiveUnrankedCount})
              </button>
            ) : null}
            {onResetFilters ? (
              <button
                type="button"
                onClick={onResetFilters}
                className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
              >
                Reset all filters
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile Card Layout (< md) */}
          <div className="space-y-3 md:hidden">
            {models.map((model, index) => {
              const isChecked = compareIds.includes(model.canonical_id);
              const sortedProviders = sortProviderOfferings(model.providers);
              const primaryProvider = sortedProviders[0];
              const bestViability = getBestModelViability(sortedProviders);
              const ranked = isRankedModel(model);
              const signals = extractBenchmarkSignals(model, 3);
              const categoryScore = getCategoryScoreConfig(model, category);
              const unrankedReason = !ranked ? getUnrankedReason(model) : null;

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
                        {ranked ? <CoverageDots model={model} /> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
                        {model.family ? <span>{model.family}</span> : null}
                        <span>· {formatContextWindow(model.context_window)}</span>
                        {model.supports_tools ? (
                          <span className="text-cyan-300">· Tools</span>
                        ) : null}
                        {model.supports_vision ? (
                          <span className="text-violet-300">· Vision</span>
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

                  {ranked ? (
                    <div className="space-y-2 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase text-zinc-400">
                          {categoryScore.label}
                        </span>
                        <div className="w-40">
                          <ScoreBar value={categoryScore.value} accent={categoryScore.accent} />
                        </div>
                      </div>
                      {signals.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {signals.map((signal) => (
                            <span
                              key={signal.key}
                              title={signal.label}
                              className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                            >
                              {signal.shortLabel}{' '}
                              <strong className="text-zinc-100">{signal.formatted}</strong>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : unrankedReason ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[11px]">
                      <span className="font-mono font-semibold text-amber-300">
                        {unrankedReason.badge}
                      </span>
                      <span className="truncate text-zinc-400">{unrankedReason.detail}</span>
                    </div>
                  ) : null}

                  {primaryProvider ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-zinc-400">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{getPrimaryLimitsSummary(primaryProvider)}</span>
                        {bestViability ? (
                          <SessionViabilityBadge viability={bestViability.viability} compact />
                        ) : null}
                      </div>
                      <CopyButton text={primaryProvider.provider_model_id} label="Copy ID" />
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
                    {scope === 'unranked' ? 'Model & Status' : 'Model'}
                  </th>

                  {scope === 'unranked' ? (
                    <>
                      <th className="px-3 py-3" aria-sort={getAriaSort('context_window')}>
                        {renderSortHeader('Specs & Context', 'context_window')}
                      </th>
                      <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                        Best Free Limits & Health
                      </th>
                      <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                        Free Providers & Model ID
                      </th>
                    </>
                  ) : tableViewMode === 'smart' ? (
                    <>
                      <th className="px-3 py-3" aria-sort={getAriaSort(primaryScoreHeader.sortKey)}>
                        <div className="flex items-center gap-2">
                          {renderSortHeader(primaryScoreHeader.label, primaryScoreHeader.sortKey)}
                          <MethodologyModal />
                        </div>
                      </th>
                      <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                        Benchmarks
                      </th>
                      <th className="px-3 py-3" aria-sort={getAriaSort('context_window')}>
                        {renderSortHeader('Specs', 'context_window')}
                      </th>
                      <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                        Best Free Limits
                      </th>
                      <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                        Free Providers & ID
                      </th>
                    </>
                  ) : (
                    <>
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
                      <th className="px-3 py-3" aria-sort={getAriaSort('context_window')}>
                        {renderSortHeader('Context', 'context_window')}
                      </th>
                      <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                        Free Providers & ID
                      </th>
                    </>
                  )}

                  <th className="w-20 px-3 py-3 text-right font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                    Inspect
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {models.map((model, index) => {
                  const isChecked = compareIds.includes(model.canonical_id);
                  const sortedProviders = sortProviderOfferings(model.providers);
                  const primaryProvider = sortedProviders[0];
                  const bestViability = getBestModelViability(sortedProviders);
                  const ranked = isRankedModel(model);
                  const signals = extractBenchmarkSignals(model, 4);
                  const categoryScore = getCategoryScoreConfig(model, category);
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
                        <ModelIdentityCell
                          model={model}
                          showUnrankedBadge={scope !== 'ranked'}
                        />
                      </td>

                      {scope === 'unranked' ? (
                        <>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs font-semibold tabular-nums text-zinc-200">
                                {formatContextWindow(model.context_window)}
                              </span>
                              <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
                                {model.supports_tools ? (
                                  <span className="inline-flex items-center gap-0.5 text-cyan-300">
                                    <Wrench className="h-3 w-3" />
                                    Tools
                                  </span>
                                ) : null}
                                {model.supports_vision ? (
                                  <span className="inline-flex items-center gap-0.5 text-violet-300">
                                    <Eye className="h-3 w-3" />
                                    Vision
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>

                          <td className="px-3 py-3">
                            {primaryProvider ? (
                              <div className="space-y-1">
                                <div className="font-mono text-xs text-zinc-200">
                                  {getPrimaryLimitsSummary(primaryProvider)}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {bestViability ? (
                                    <SessionViabilityBadge
                                      viability={bestViability.viability}
                                      compact
                                    />
                                  ) : null}
                                  <EndpointHealthBadge offering={primaryProvider} />
                                </div>
                              </div>
                            ) : (
                              <span className="font-mono text-xs text-zinc-500">—</span>
                            )}
                          </td>
                        </>
                      ) : tableViewMode === 'smart' ? (
                        <>
                          <td className="px-3 py-3">
                            {ranked ? (
                              <ScoreBar
                                value={categoryScore.value}
                                accent={categoryScore.accent}
                              />
                            ) : (
                              <span className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                                {getUnrankedReason(model).badge}
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-3">
                            {signals.length > 0 ? (
                              <div className="flex max-w-[220px] flex-wrap gap-1">
                                {signals.map((signal) => (
                                  <span
                                    key={signal.key}
                                    title={signal.label}
                                    className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-300"
                                  >
                                    {signal.shortLabel}{' '}
                                    <strong className="text-zinc-100">{signal.formatted}</strong>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="font-mono text-[11px] text-zinc-500">
                                Awaiting evals
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs tabular-nums text-zinc-200">
                                {formatContextWindow(model.context_window)}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {model.supports_tools ? (
                                  <Wrench
                                    className="h-3 w-3 text-cyan-400"
                                    aria-label="Supports tools"
                                  />
                                ) : null}
                                {model.supports_vision ? (
                                  <Eye
                                    className="h-3 w-3 text-violet-400"
                                    aria-label="Supports vision"
                                  />
                                ) : null}
                              </div>
                            </div>
                          </td>

                          <td className="px-3 py-3">
                            {primaryProvider ? (
                              <div className="space-y-1">
                                <div className="font-mono text-[11px] text-zinc-200">
                                  {getPrimaryLimitsSummary(primaryProvider)}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {bestViability ? (
                                    <SessionViabilityBadge
                                      viability={bestViability.viability}
                                      compact
                                    />
                                  ) : null}
                                  <EndpointHealthBadge offering={primaryProvider} />
                                </div>
                              </div>
                            ) : (
                              <span className="font-mono text-xs text-zinc-500">—</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
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

                          <td className="px-3 py-3 font-mono text-xs tabular-nums text-zinc-300">
                            {formatContextWindow(model.context_window)}
                          </td>
                        </>
                      )}

                      {/* Providers + inline 1-click model ID copy */}
                      <td className="px-3 py-3">
                        <div className="space-y-1.5">
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
                          {primaryProvider ? (
                            <div
                              className="flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <code className="max-w-[165px] truncate rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                                {primaryProvider.provider_model_id}
                              </code>
                              <CopyButton text={primaryProvider.provider_model_id} />
                            </div>
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
      )}

      {/* Stealth & Unranked Discovery Footer */}
      {scope === 'ranked' && effectiveUnrankedCount > 0 && onChangeScope ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/35 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <Compass className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>{effectiveUnrankedCount}</strong> stealth, preview, and newly added free
              models match your filters and are ready to use without benchmark scores yet.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onChangeScope('unranked')}
            className="font-mono text-[11px] font-semibold text-amber-300 hover:text-amber-200 hover:underline"
          >
            Explore Stealth & Unranked →
          </button>
        </div>
      ) : null}
    </div>
  );
}
