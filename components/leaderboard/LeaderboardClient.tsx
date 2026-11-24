'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bookmark,
  GitCompare,
  KeyRound,
  Rss,
  X,
} from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { trackEvent } from '@/lib/analytics/track';
import {
  createDefaultFilters,
  DEFAULT_SORT_BY_CATEGORY,
  parseLeaderboardSearchParams,
  serializeLeaderboardSearchParams,
  type LeaderboardFilterState,
  type SortCategory,
  type SortKey,
} from '@/lib/leaderboard/url-state';
import { KEYLESS_PROVIDERS, loadMyKeys, saveMyKeys } from '@/lib/providers/my-keys';
import {
  analyzePinnedStackStatus,
  loadMyStack,
  saveMyStack,
  togglePinnedModel,
  type PinnedStackItem,
} from '@/lib/providers/my-stack';
import { getProvidersConfig } from '@/lib/providers/types';
import type { LeaderboardModel, ProviderSlug } from '@/lib/supabase/types';
import { FilterBar } from './FilterBar';
import { LeaderboardTable } from './LeaderboardTable';
import { ModelDetailDrawer } from './ModelDetailDrawer';

interface LeaderboardClientProps {
  models: LeaderboardModel[];
  initialCategory?: SortCategory;
  initialFilters?: Partial<LeaderboardFilterState>;
  syncUrl?: boolean;
}

/**
 * Interactive client controller for filtering, sorting, URL state syncing,
 * "My Free Keys" filtering, model comparison selection, and quick inspection.
 */
export function LeaderboardClient({
  models,
  initialCategory = 'overall',
  initialFilters,
  syncUrl = true,
}: LeaderboardClientProps) {
  const searchParams = useSearchParams();
  const defaults = useMemo(
    () => ({
      filters: createDefaultFilters(initialCategory, initialFilters),
      sortKey: DEFAULT_SORT_BY_CATEGORY[initialCategory],
      sortAsc: false,
    }),
    [initialCategory, initialFilters]
  );

  const initialParsed = useMemo(
    () =>
      syncUrl
        ? parseLeaderboardSearchParams(new URLSearchParams(searchParams.toString()), defaults)
        : defaults,
    // Initialize once from current searchParams/defaults on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [filters, setFilters] = useState<LeaderboardFilterState>(initialParsed.filters);
  const [sortKey, setSortKey] = useState<SortKey>(initialParsed.sortKey);
  const [sortAsc, setSortAsc] = useState<boolean>(initialParsed.sortAsc);
  const [myKeys, setMyKeys] = useState<ProviderSlug[]>([]);
  const [pinnedStack, setPinnedStack] = useState<PinnedStackItem[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    setMyKeys(loadMyKeys());
    setPinnedStack(loadMyStack());
  }, []);

  useEffect(() => {
    if (!syncUrl) return;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const query = serializeLeaderboardSearchParams(filters, sortKey, sortAsc, {
      filters: defaults.filters,
      sortKey: defaults.sortKey,
    });
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);
  }, [filters, sortKey, sortAsc, syncUrl, defaults]);

  function handleFilterChange(next: LeaderboardFilterState) {
    if (next.category !== filters.category) {
      setSortKey(DEFAULT_SORT_BY_CATEGORY[next.category]);
      setSortAsc(false);
      trackEvent('task_filter_selected', { category: next.category });
    }
    if (next.zeroTrainingOnly !== filters.zeroTrainingOnly) {
      trackEvent('privacy_toggle_changed', { enabled: next.zeroTrainingOnly });
    }
    setFilters(next);
  }

  function handleChangeMyKeys(nextKeys: ProviderSlug[]) {
    setMyKeys(nextKeys);
    saveMyKeys(nextKeys);
  }

  function handleTogglePin(
    model: Pick<LeaderboardModel, 'canonical_id' | 'display_name' | 'freebench_score'>
  ) {
    const next = togglePinnedModel(pinnedStack, model);
    setPinnedStack(next);
    saveMyStack(next);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function handleToggleCompare(canonicalId: string) {
    setCompareIds((prev) => {
      if (prev.includes(canonicalId)) {
        return prev.filter((id) => id !== canonicalId);
      }
      if (prev.length >= 4) return prev;
      return [...prev, canonicalId];
    });
  }

  function handleResetFilters() {
    setFilters(defaults.filters);
    setSortKey(defaults.sortKey);
    setSortAsc(false);
  }

  const myKeysSet = useMemo(() => new Set(myKeys), [myKeys]);
  const providersConfig = useMemo(() => getProvidersConfig(), []);
  const pinnedIds = useMemo(
    () => new Set(pinnedStack.map((item) => item.canonicalId)),
    [pinnedStack]
  );
  const pinnedAlerts = useMemo(
    () => analyzePinnedStackStatus(pinnedStack, models, []),
    [pinnedStack, models]
  );
  const pinnedRssPath = useMemo(() => {
    if (pinnedStack.length === 0) return '/feed.xml?type=drops';
    return `/feed.xml?model=${encodeURIComponent(
      pinnedStack.map((i) => i.canonicalId).join(',')
    )}&type=drops`;
  }, [pinnedStack]);

  const filteredModels = useMemo(() => {
    const query = filters.query.trim().toLowerCase();

    const mapped = models
      .map((model) => {
        const compliantProviders = model.providers.filter((p) => {
          if (filters.alwaysFreeOnly && p.tier_type !== 'always_free') return false;
          if (
            filters.directApiOnly &&
            providersConfig[p.provider_slug]?.access_mode === 'harness_only'
          ) {
            return false;
          }
          if (filters.zeroTrainingOnly && p.trains_on_data) return false;
          if (filters.myKeysOnly && !myKeysSet.has(p.provider_slug)) return false;
          return true;
        });

        return {
          ...model,
          providers: compliantProviders,
          active_provider_count: compliantProviders.length,
        };
      })
      .filter((model) => {
        if (model.providers.length === 0) return false;
        if (filters.toolsOnly && model.supports_tools !== true) return false;
        if (filters.visionOnly && model.supports_vision !== true) return false;
        if (filters.openWeightsOnly && model.is_open_weights !== true) return false;
        if (filters.minContext > 0 && (model.context_window ?? 0) < filters.minContext) {
          return false;
        }
        if (filters.selectedProviders.length > 0) {
          const hasProvider = model.providers.some((p) =>
            filters.selectedProviders.includes(p.provider_slug as ProviderSlug)
          );
          if (!hasProvider) return false;
        }
        if (filters.category === 'agentic' && model.supports_tools === false) {
          return false;
        }
        if (query) {
          const hay = [
            model.canonical_id,
            model.display_name,
            model.family ?? '',
            ...model.providers.map((p) => `${p.provider_slug} ${p.provider_model_id}`),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      });

    mapped.sort((a, b) => {
      const aVal = a[sortKey] ?? null;
      const bVal = b[sortKey] ?? null;
      if (aVal === null && bVal === null) return a.display_name.localeCompare(b.display_name);
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return sortAsc ? aVal - bVal : bVal - aVal;
    });

    return mapped;
  }, [models, filters, sortKey, sortAsc, myKeysSet, providersConfig]);

  const activeModel = useMemo(
    () => filteredModels.find((m) => m.canonical_id === activeModelId) ?? null,
    [filteredModels, activeModelId]
  );

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        myKeys={myKeys}
        onChangeMyKeys={handleChangeMyKeys}
        totalCount={models.length}
        filteredCount={filteredModels.length}
        defaultCategory={initialCategory}
      />

      {filters.myKeysOnly && myKeys.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-200">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-cyan-300" />
            <span>
              <strong>My Keys Only</strong> is active, but no providers are selected yet. Check
              your API keys in the selector above or start with the 4 zero-key providers.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleChangeMyKeys([...KEYLESS_PROVIDERS])}
            className="rounded-md border border-cyan-400/50 bg-cyan-500/20 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30"
          >
            Enable 4 Keyless Providers
          </button>
        </div>
      ) : null}

      {pinnedAlerts.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-xs font-semibold text-zinc-200">
              <Bookmark className="h-3.5 w-3.5 text-cyan-400" />
              <span>My Pinned Stack ({pinnedAlerts.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={pinnedRssPath}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-300 hover:underline"
              >
                <Rss className="h-3 w-3" />
                <span>Drop RSS</span>
              </Link>
              <CopyButton text={pinnedRssPath} label="Copy RSS" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {pinnedAlerts.map((alert) => (
              <div
                key={alert.item.canonicalId}
                className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                  alert.status === 'dropped'
                    ? 'border-rose-500/45 bg-rose-500/10 text-rose-200'
                    : alert.status === 'overtaken'
                      ? 'border-amber-500/45 bg-amber-500/10 text-amber-200'
                      : 'border-zinc-800 bg-zinc-950/80 text-zinc-200'
                }`}
              >
                {alert.status !== 'healthy' ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                ) : null}
                <Link
                  href={`/models/${encodeURIComponent(alert.item.canonicalId)}`}
                  className="font-semibold hover:underline"
                >
                  {alert.item.displayName}
                </Link>
                <span className="font-mono text-[10px] opacity-85">
                  {alert.status === 'dropped'
                    ? 'Dropped'
                    : alert.status === 'overtaken' && alert.replacement
                      ? `Overtaken by ${alert.replacement.display_name}`
                      : alert.reason}
                </span>
                {alert.status !== 'healthy' && alert.replacement ? (
                  <Link
                    href={`/models/${encodeURIComponent(alert.replacement.canonical_id)}`}
                    className="font-mono text-[10px] text-emerald-300 underline"
                  >
                    Switch →
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    handleTogglePin({
                      canonical_id: alert.item.canonicalId,
                      display_name: alert.item.displayName,
                      freebench_score: alert.item.pinnedScore,
                    })
                  }
                  aria-label={`Unpin ${alert.item.displayName}`}
                  className="rounded p-0.5 opacity-70 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <LeaderboardTable
        models={filteredModels}
        category={filters.category}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={handleSort}
        onSelectModel={(model) => setActiveModelId(model.canonical_id)}
        compareIds={compareIds}
        onToggleCompare={handleToggleCompare}
        pinnedIds={pinnedIds}
        onTogglePin={handleTogglePin}
        onResetFilters={handleResetFilters}
      />

      {/* Sticky Compare Tray */}
      {compareIds.length > 0 ? (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-emerald-500/40 bg-zinc-900/95 px-4 py-2 shadow-2xl backdrop-blur-md">
          <span className="font-mono text-xs text-zinc-200">{compareIds.length}/4 selected</span>
          <Link
            href={`/compare?models=${encodeURIComponent(compareIds.join(','))}`}
            onClick={() => trackEvent('models_compared', { count: compareIds.length })}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            <GitCompare className="h-3.5 w-3.5" />
            <span>Compare</span>
          </Link>
          <button
            type="button"
            onClick={() => setCompareIds([])}
            aria-label="Clear comparison selection"
            className="rounded-full p-1 text-zinc-400 hover:text-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <ModelDetailDrawer
        model={activeModel}
        onClose={() => setActiveModelId(null)}
        isPinned={activeModel ? pinnedIds.has(activeModel.canonical_id) : false}
        onTogglePin={activeModel ? () => handleTogglePin(activeModel) : undefined}
      />
    </div>
  );
}
