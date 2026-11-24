'use client';

import { Coins, ShieldAlert, ShieldCheck, Terminal } from 'lucide-react';
import { InfoPopover } from '@/components/InfoPopover';
import {
  computeSessionViability,
  formatCompactNumber,
  resolveEffectiveLimits,
} from '@/lib/providers/limits';
import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderOffering } from '@/lib/supabase/types';

interface ProviderBadgeProps {
  offering: ProviderOffering;
  compact?: boolean;
}

/**
 * Displays a provider offering pill with distinct visual treatment for Direct API,
 * Harness-Only Free (violet), Trains-on-Data (rose), and One-Time Trial Credits (dashed amber),
 * plus an accessible hover/focus/tap popover.
 */
export function ProviderBadge({ offering, compact = false }: ProviderBadgeProps) {
  const config = getProvidersConfig()[offering.provider_slug];
  const label = compact ? config.display_name.replace(' (Free)', '') : config.display_name;
  const isTrialCredit = offering.tier_type === 'trial_credit';
  const isHarnessOnly = config.access_mode === 'harness_only';
  const harnessLabel = config.harness_name ?? config.display_name;
  const limits = resolveEffectiveLimits(offering);
  const viability = computeSessionViability(offering);

  const badgeTone = isTrialCredit
    ? 'border border-dashed border-amber-500/55 bg-amber-500/10 text-amber-200 hover:border-amber-400'
    : offering.trains_on_data
      ? 'border border-rose-500/45 bg-rose-500/10 text-rose-200 hover:border-rose-400'
      : isHarnessOnly
        ? 'border border-violet-500/45 bg-violet-500/10 text-violet-200 hover:border-violet-400'
        : 'border border-zinc-700/80 bg-zinc-900 text-zinc-200 hover:border-emerald-500/50';

  const trigger = (
    <span className="inline-flex items-center gap-1">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: config.badge_color ?? '#10b981' }}
      />
      <span>{label}</span>
      {isHarnessOnly ? (
        <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/20 px-1 text-[9px] font-semibold uppercase tracking-wide text-violet-200">
          <Terminal className="h-2.5 w-2.5" />
          Harness
        </span>
      ) : null}
      {isTrialCredit ? (
        <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
          <Coins className="h-2.5 w-2.5" />
          Credit
        </span>
      ) : null}
      {offering.trains_on_data ? (
        <ShieldAlert className="h-3 w-3 text-rose-400" aria-label="Trains on data" />
      ) : (
        <ShieldCheck className="h-3 w-3 text-emerald-400" aria-label="Zero data training" />
      )}
    </span>
  );

  const popoverContent = (
    <span className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2 font-semibold text-zinc-100">
        <span>{config.display_name}</span>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
            isTrialCredit
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-emerald-500/15 text-emerald-300'
          }`}
        >
          {isTrialCredit ? 'One-Time Credit' : 'Always Free'}
        </span>
      </span>
      <span
        className={`block font-mono text-[11px] ${
          isHarnessOnly ? 'text-violet-300' : 'text-emerald-300'
        }`}
      >
        {isHarnessOnly
          ? `Harness-Only Free (${harnessLabel} — not a standalone public API)`
          : 'Direct HTTP API (cURL, SDKs, any agent)'}
      </span>
      <span className="block font-mono text-[11px] text-zinc-300">
        {limits.rpmLabel} · {limits.rpdLabel}
      </span>
      {limits.tpmInt !== null || limits.tpdInt !== null ? (
        <span className="block font-mono text-[11px] text-zinc-400">
          {limits.tpmInt !== null ? `${formatCompactNumber(limits.tpmInt)} TPM` : ''}
          {limits.tpmInt !== null && limits.tpdInt !== null ? ' · ' : ''}
          {limits.tpdInt !== null ? `${formatCompactNumber(limits.tpdInt)} TPD` : ''}
        </span>
      ) : null}
      <span className="block font-mono text-[11px] text-cyan-300">
        Session: {viability.label} ({viability.reason})
      </span>
      <span
        className={`block text-[11px] ${
          offering.trains_on_data ? 'text-rose-300' : 'text-emerald-300'
        }`}
      >
        {offering.trains_on_data
          ? config.privacy_note ?? 'Free tier may use prompts for model training'
          : 'Zero free-tier prompt training'}
      </span>
      {limits.quotaResetLabel ? (
        <span className="block font-mono text-[10px] text-zinc-400">
          Reset: {limits.quotaResetLabel}
        </span>
      ) : null}
    </span>
  );

  return (
    <InfoPopover
      trigger={trigger}
      content={popoverContent}
      ariaLabel={`${config.display_name} free tier details`}
      triggerClassName={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${badgeTone}`}
    />
  );
}
