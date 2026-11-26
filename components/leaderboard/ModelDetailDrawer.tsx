'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bookmark, Compass, ExternalLink, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { EndpointHealthBadge } from '@/components/EndpointHealthBadge';
import { MethodologyModal } from '@/components/MethodologyModal';
import { PaidEscapeHatchCard } from '@/components/PaidEscapeHatchCard';
import { ResetCountdown } from '@/components/ResetCountdown';
import { ScoreBar } from '@/components/ScoreBar';
import { SessionViabilityBadge } from '@/components/SessionViabilityBadge';
import { SnippetPanel } from '@/components/SnippetPanel';
import { formatContextWindow, formatScore } from '@/lib/format';
import {
  getPrimaryLimitsSummary,
  getUnrankedReason,
  isRankedModel,
} from '@/lib/leaderboard/display';
import {
  computeSessionViability,
  formatCompactNumber,
  resolveEffectiveLimits,
  sortProviderOfferings,
} from '@/lib/providers/limits';
import { getProvidersConfig } from '@/lib/providers/types';
import type { LeaderboardModel } from '@/lib/supabase/types';

interface ModelDetailDrawerProps {
  model: LeaderboardModel | null;
  onClose: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible slide-over inspection drawer with Escape close, body scroll lock,
 * keyboard focus trap, and focus restoration on close.
 */
export function ModelDetailDrawer({
  model,
  onClose,
  isPinned = false,
  onTogglePin,
}: ModelDetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!model) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab' && drawerRef.current) {
        const focusable = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );
        if (focusable.length === 0) return;

        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [model, onClose]);

  if (!model) return null;

  const providersConfig = getProvidersConfig();
  const sortedProviders = sortProviderOfferings(model.providers);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`${model.display_name} details`}
      onClick={onClose}
    >
      <div
        ref={drawerRef}
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-zinc-100">{model.display_name}</h2>
              {model.is_open_weights ? (
                <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
                  Open Weights
                </span>
              ) : null}
            </div>
            <p className="mt-1 font-mono text-xs text-zinc-400">
              {model.canonical_id} · Context {formatContextWindow(model.context_window)} ·{' '}
              {sortedProviders.length} active free provider
              {sortedProviders.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onTogglePin ? (
              <button
                type="button"
                onClick={onTogglePin}
                aria-pressed={isPinned}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isPinned
                    ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-700'
                }`}
              >
                <Bookmark className="h-3.5 w-3.5" />
                <span>{isPinned ? 'Pinned' : 'Pin'}</span>
              </button>
            ) : null}
            <Link
              href={`/models/${encodeURIComponent(model.canonical_id)}`}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-700"
            >
              Full Page
            </Link>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Top Quick-Use Card */}
        {sortedProviders[0] ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                  Best Free Route
                </span>
                <span className="text-xs font-semibold text-zinc-100">
                  {providersConfig[sortedProviders[0].provider_slug].display_name}
                </span>
                <SessionViabilityBadge
                  viability={computeSessionViability(sortedProviders[0])}
                  compact
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-300">
                <code className="max-w-[240px] truncate rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-200">
                  {sortedProviders[0].provider_model_id}
                </code>
                <CopyButton text={sortedProviders[0].provider_model_id} label="Copy ID" />
                <span className="text-zinc-400">· {getPrimaryLimitsSummary(sortedProviders[0])}</span>
              </div>
            </div>
            <a
              href={sortedProviders[0].signup_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
            >
              <span>API Key</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : null}

        {/* Benchmark breakdown */}
        <section className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Benchmark Breakdown ({model.benchmark_coverage}/3 Composite Pillars)
            </h3>
            <MethodologyModal />
          </div>

          {!isRankedModel(model) ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-100">
              <Compass className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div className="space-y-1">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                  {getUnrankedReason(model).badge}
                </div>
                <p className="text-zinc-200">{getUnrankedReason(model).detail}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {model.freebench_score !== null ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="text-[11px] text-zinc-400">FreeBench Composite</div>
                    <div className="mt-1">
                      <ScoreBar value={model.freebench_score} accent="emerald" />
                    </div>
                  </div>
                ) : null}
                {model.agentic_coding_score !== null ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="text-[11px] text-zinc-400">Agentic Coding</div>
                    <div className="mt-1">
                      <ScoreBar value={model.agentic_coding_score} accent="cyan" />
                    </div>
                  </div>
                ) : null}
                {model.bfcl_overall !== null ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="text-[11px] text-zinc-400">BFCL Tool Calling</div>
                    <div className="mt-1">
                      <ScoreBar value={model.bfcl_overall} accent="amber" />
                    </div>
                  </div>
                ) : null}
                {model.eci_score !== null ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="text-[11px] text-zinc-400">Epoch ECI (Raw)</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                      {formatScore(model.eci_score)}
                    </div>
                  </div>
                ) : null}
                {model.livebench_coding !== null ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="text-[11px] text-zinc-400">LiveBench Coding</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                      {formatScore(model.livebench_coding)}
                    </div>
                  </div>
                ) : null}
                {model.livebench_reasoning !== null || model.livebench_math !== null ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="text-[11px] text-zinc-400">LiveBench Reasoning / Math</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                      {formatScore(model.livebench_reasoning)} / {formatScore(model.livebench_math)}
                    </div>
                  </div>
                ) : null}
                {typeof model.swebench_verified === 'number' ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="text-[11px] text-zinc-400">SWE-bench Verified</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                      {formatScore(model.swebench_verified)}%
                    </div>
                  </div>
                ) : null}
                {typeof model.aider_polyglot === 'number' ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div className="text-[11px] text-zinc-400">Aider Polyglot</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-100">
                      {formatScore(model.aider_polyglot)}%
                    </div>
                  </div>
                ) : null}
              </div>

              {model.benchmark_coverage < 3 ? (
                <p className="font-mono text-[11px] text-zinc-400">
                  Awaiting:{' '}
                  {[
                    model.eci_score === null ? 'Epoch ECI' : null,
                    model.livebench_global === null ? 'LiveBench' : null,
                    model.bfcl_overall === null ? 'BFCL' : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              ) : null}
            </>
          )}
        </section>

        {/* Free Providers Matrix */}
        <section className="mt-6 space-y-3">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Active Free Providers
          </h3>
          <div className="space-y-2">
            {sortedProviders.map((offering) => {
              const cfg = providersConfig[offering.provider_slug];
              const limits = resolveEffectiveLimits(offering);
              const viability = computeSessionViability(offering);
              return (
                <div
                  key={`${offering.provider_slug}-${offering.provider_model_id}`}
                  className="flex flex-col justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:flex-row sm:items-center"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/providers/${offering.provider_slug}`}
                        className="text-xs font-semibold text-zinc-100 hover:text-emerald-400"
                      >
                        {cfg.display_name}
                      </Link>
                      {offering.tier_type === 'trial_credit' ? (
                        <span className="rounded border border-dashed border-amber-500/50 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                          One-Time Credit
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                          Always Free
                        </span>
                      )}
                      {cfg.access_mode === 'harness_only' ? (
                        <span className="rounded border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] text-violet-200">
                          Harness-Only ({cfg.harness_name ?? cfg.display_name})
                        </span>
                      ) : (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                          Direct API
                        </span>
                      )}
                      {offering.trains_on_data ? (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                          <ShieldAlert className="h-3 w-3" /> Trains on data
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                          <ShieldCheck className="h-3 w-3" /> Zero training
                        </span>
                      )}
                      {offering.zdr_available ? (
                        <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                          ZDR
                        </span>
                      ) : null}
                      <SessionViabilityBadge viability={viability} compact />
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
                      <span>
                        ID: <span className="text-zinc-200">{offering.provider_model_id}</span>
                      </span>
                      <CopyButton text={offering.provider_model_id} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
                      <span>
                        {limits.rpmLabel} · {limits.rpdLabel}
                        {limits.tpmInt !== null
                          ? ` · ${formatCompactNumber(limits.tpmInt)} TPM`
                          : ''}
                        {limits.tpdInt !== null
                          ? ` · ${formatCompactNumber(limits.tpdInt)} TPD`
                          : ''}
                        {' · Context '}
                        {formatContextWindow(offering.context_window ?? model.context_window)}
                      </span>
                      <ResetCountdown
                        resetTz={limits.quotaResetTz}
                        fallbackLabel={limits.quotaResetLabel}
                      />
                    </div>
                    <EndpointHealthBadge offering={offering} />
                    {cfg.tier_note ? (
                      <div className="text-[11px] text-zinc-400">{cfg.tier_note}</div>
                    ) : null}
                  </div>

                  <a
                    href={`/go/${offering.provider_slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-emerald-500/50 hover:text-emerald-300"
                  >
                    <span>API Key</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              );
            })}
          </div>
        </section>

        {/* Honest Paid Escape Hatch */}
        <section className="mt-6">
          <PaidEscapeHatchCard canonicalId={model.canonical_id} displayName={model.display_name} />
        </section>

        {/* Copyable Snippets & Agent Configs */}
        <section className="mt-6">
          <SnippetPanel providers={sortedProviders} canonicalId={model.canonical_id} />
        </section>
      </div>
    </div>
  );
}
