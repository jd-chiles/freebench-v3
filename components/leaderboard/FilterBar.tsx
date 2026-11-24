'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Eye,
  Globe,
  Infinity as InfinityIcon,
  KeyRound,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  X,
} from 'lucide-react';
import {
  createDefaultFilters,
  type LeaderboardFilterState,
  type SortCategory,
} from '@/lib/leaderboard/url-state';
import { KEYLESS_PROVIDERS } from '@/lib/providers/my-keys';
import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';

export type { LeaderboardFilterState, SortCategory };

interface FilterBarProps {
  filters: LeaderboardFilterState;
  onChange: (next: LeaderboardFilterState) => void;
  myKeys: ProviderSlug[];
  onChangeMyKeys: (keys: ProviderSlug[]) => void;
  totalCount: number;
  filteredCount: number;
  defaultCategory?: SortCategory;
}

const CATEGORY_TABS: ReadonlyArray<{ id: SortCategory; label: string }> = [
  { id: 'overall', label: 'Overall' },
  { id: 'agentic', label: 'Agentic Coding' },
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
  { value: 1_000_000, label: '1M+ tokens' },
];

const KEYLESS_SET = new Set<ProviderSlug>(KEYLESS_PROVIDERS);

/**
 * Interactive filter toolbar with URL-synced categories, "/" search shortcut,
 * searchable grouped provider dropdown, and localStorage-backed "My Free Keys" selector.
 */
export function FilterBar({
  filters,
  onChange,
  myKeys,
  onChangeMyKeys,
  totalCount,
  filteredCount,
  defaultCategory = 'overall',
}: FilterBarProps) {
  const providersConfig = getProvidersConfig();
  const providerSlugs = Object.keys(providersConfig) as ProviderSlug[];

  const [providerOpen, setProviderOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState('');
  const [myKeysOpen, setMyKeysOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const myKeysMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setProviderOpen(false);
        setMyKeysOpen(false);
        return;
      }

      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          target?.isContentEditable
        ) {
          return;
        }
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (providerMenuRef.current && !providerMenuRef.current.contains(target)) {
        setProviderOpen(false);
      }
      if (myKeysMenuRef.current && !myKeysMenuRef.current.contains(target)) {
        setMyKeysOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, []);

  const groupedProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    const matches = providerSlugs.filter((slug) => {
      if (!q) return true;
      const cfg = providersConfig[slug];
      return slug.includes(q) || cfg.display_name.toLowerCase().includes(q);
    });

    return {
      directKeyless: matches.filter(
        (s) => KEYLESS_SET.has(s) && providersConfig[s].access_mode === 'direct_api'
      ),
      directKeyed: matches.filter(
        (s) =>
          !KEYLESS_SET.has(s) &&
          providersConfig[s].access_mode === 'direct_api' &&
          providersConfig[s].tier_type === 'always_free'
      ),
      harnessOnly: matches.filter((s) => providersConfig[s].access_mode === 'harness_only'),
      trialCredit: matches.filter((s) => providersConfig[s].tier_type === 'trial_credit'),
    };
  }, [providerQuery, providerSlugs, providersConfig]);

  function toggleProvider(slug: ProviderSlug) {
    const exists = filters.selectedProviders.includes(slug);
    const nextProviders = exists
      ? filters.selectedProviders.filter((p) => p !== slug)
      : [...filters.selectedProviders, slug];
    onChange({ ...filters, selectedProviders: nextProviders });
  }

  function toggleMyKey(slug: ProviderSlug) {
    const exists = myKeys.includes(slug);
    const nextKeys = exists ? myKeys.filter((k) => k !== slug) : [...myKeys, slug];
    onChangeMyKeys(nextKeys);
  }

  function selectAllAlwaysFreeProviders() {
    const alwaysFree = providerSlugs.filter(
      (s) => providersConfig[s].tier_type === 'always_free'
    );
    onChange({ ...filters, selectedProviders: alwaysFree });
  }

  function resetAll() {
    onChange(createDefaultFilters(defaultCategory));
  }

  const hasActiveFilters =
    filters.query.trim().length > 0 ||
    filters.alwaysFreeOnly ||
    filters.directApiOnly ||
    filters.zeroTrainingOnly ||
    filters.toolsOnly ||
    filters.visionOnly ||
    filters.openWeightsOnly ||
    filters.myKeysOnly ||
    filters.minContext > 0 ||
    filters.selectedProviders.length > 0;

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      {/* Top row: Category tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Benchmark category">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filters.category === tab.id}
              onClick={() => onChange({ ...filters, category: tab.id })}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filters.category === tab.id
                  ? 'bg-emerald-500 font-semibold text-zinc-950'
                  : 'bg-zinc-950 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 font-mono text-xs text-zinc-400">
          <span>
            Showing <strong className="text-zinc-100">{filteredCount}</strong> of {totalCount} models
          </span>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
            >
              <X className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Middle row: Search + Capability/Privacy toggles */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchInputRef}
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Filter by model, family, or provider ID (press / to focus)..."
            aria-label="Search models"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-9 pr-10 text-xs text-zinc-100 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none"
          />
          {!filters.query ? (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              /
            </kbd>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...filters, alwaysFreeOnly: !filters.alwaysFreeOnly })}
            aria-pressed={filters.alwaysFreeOnly}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              filters.alwaysFreeOnly
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
            }`}
            title="Exclude one-time signup/trial credit providers and keep recurring always-free tiers only"
          >
            <InfinityIcon className="h-3.5 w-3.5" />
            <span>Always Free Only</span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...filters, directApiOnly: !filters.directApiOnly })}
            aria-pressed={filters.directApiOnly}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              filters.directApiOnly
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
            }`}
            title="Exclude harness-only free tiers (Kilo Code, OpenCode Zen) and show direct HTTP API endpoints only"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Direct API Only</span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...filters, zeroTrainingOnly: !filters.zeroTrainingOnly })}
            aria-pressed={filters.zeroTrainingOnly}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              filters.zeroTrainingOnly
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
            }`}
            title="Exclude free-tier offerings that may train on prompts"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Zero Data Training</span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...filters, toolsOnly: !filters.toolsOnly })}
            aria-pressed={filters.toolsOnly}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              filters.toolsOnly
                ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            <span>Tools</span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...filters, visionOnly: !filters.visionOnly })}
            aria-pressed={filters.visionOnly}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              filters.visionOnly
                ? 'border-violet-500/60 bg-violet-500/15 text-violet-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>Vision</span>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...filters, openWeightsOnly: !filters.openWeightsOnly })}
            aria-pressed={filters.openWeightsOnly}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              filters.openWeightsOnly
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            Open Weights
          </button>

          <select
            value={filters.minContext}
            onChange={(e) => onChange({ ...filters, minContext: Number(e.target.value) })}
            aria-label="Minimum context window"
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
          >
            {CONTEXT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bottom row: Compact Provider Multi-Select + My Free Keys */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Providers Dropdown */}
          <div ref={providerMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setProviderOpen((prev) => !prev);
                setMyKeysOpen(false);
              }}
              aria-expanded={providerOpen}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                filters.selectedProviders.length > 0
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>
                Providers
                {filters.selectedProviders.length > 0
                  ? ` (${filters.selectedProviders.length})`
                  : ''}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>

            {providerOpen ? (
              <div className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl">
                <div className="space-y-2">
                  <input
                    type="search"
                    value={providerQuery}
                    onChange={(e) => setProviderQuery(e.target.value)}
                    placeholder="Search 15 providers..."
                    aria-label="Search providers"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <button
                      type="button"
                      onClick={selectAllAlwaysFreeProviders}
                      className="text-emerald-400 hover:underline"
                    >
                      Select Always-Free
                    </button>
                    {filters.selectedProviders.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => onChange({ ...filters, selectedProviders: [] })}
                        className="text-zinc-400 hover:text-zinc-200"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2.5 max-h-64 space-y-3 overflow-y-auto pr-1">
                  {[
                    { title: 'Direct API (Keyless)', items: groupedProviders.directKeyless },
                    { title: 'Direct API (Free Key)', items: groupedProviders.directKeyed },
                    { title: 'Harness-Only Free', items: groupedProviders.harnessOnly },
                    { title: 'One-Time Trial Credit', items: groupedProviders.trialCredit },
                  ].map((group) =>
                    group.items.length > 0 ? (
                      <div key={group.title} className="space-y-1">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                          {group.title}
                        </div>
                        {group.items.map((slug) => {
                          const cfg = providersConfig[slug];
                          const checked = filters.selectedProviders.includes(slug);
                          return (
                            <label
                              key={slug}
                              className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-900"
                            >
                              <span className="flex items-center gap-2 truncate">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleProvider(slug)}
                                  className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-emerald-500"
                                />
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: cfg.badge_color ?? '#10b981' }}
                                />
                                <span className="truncate">
                                  {cfg.display_name.replace(' (Free)', '')}
                                </span>
                              </span>
                              <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                                {cfg.tier_type === 'trial_credit'
                                  ? 'Credit'
                                  : cfg.access_mode === 'harness_only'
                                    ? 'Harness'
                                    : 'API'}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* My Free Keys Toggle & Selector */}
          <div ref={myKeysMenuRef} className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChange({ ...filters, myKeysOnly: !filters.myKeysOnly })}
              aria-pressed={filters.myKeysOnly}
              className={`inline-flex items-center gap-1.5 rounded-l-md border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                filters.myKeysOnly
                  ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
              }`}
              title="Filter models runnable with your saved free API keys"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>My Keys ({myKeys.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMyKeysOpen((prev) => !prev);
                setProviderOpen(false);
              }}
              aria-expanded={myKeysOpen}
              aria-label="Configure my free API keys"
              className="rounded-r-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>

            {myKeysOpen ? (
              <div className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="text-xs font-semibold text-zinc-100">
                    My Free API Keys
                  </span>
                  <div className="flex gap-2 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => onChangeMyKeys([...KEYLESS_PROVIDERS])}
                      className="text-cyan-400 hover:underline"
                    >
                      Keyless Only
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeMyKeys([])}
                      className="text-zinc-400 hover:text-zinc-200"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  Saved locally in your browser. Synced with Stack Builder.
                </p>
                <div className="mt-2 max-h-60 space-y-1 overflow-y-auto pr-1">
                  {providerSlugs.map((slug) => {
                    const cfg = providersConfig[slug];
                    const checked = myKeys.includes(slug);
                    const isKeyless = KEYLESS_SET.has(slug);
                    return (
                      <label
                        key={slug}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-900"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMyKey(slug)}
                            className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 accent-cyan-500"
                          />
                          <span className="truncate">
                            {cfg.display_name.replace(' (Free)', '')}
                          </span>
                        </span>
                        {isKeyless ? (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-300">
                            Keyless
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {/* Active provider removal chips */}
          {filters.selectedProviders.map((slug) => {
            const cfg = providersConfig[slug];
            return (
              <button
                key={slug}
                type="button"
                onClick={() => toggleProvider(slug)}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-200 hover:bg-emerald-500/20"
              >
                <span>{cfg.display_name.replace(' (Free)', '')}</span>
                <X className="h-3 w-3" />
              </button>
            );
          })}
        </div>

        <span className="font-mono text-[11px] text-zinc-400">
          Solid = Direct API · Violet = Harness-Only · Rose = Trains · Dashed = Credit
        </span>
      </div>
    </div>
  );
}
