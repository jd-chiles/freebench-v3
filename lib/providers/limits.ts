import { getProvidersConfig, type ModelLimitOverride } from '@/lib/providers/types';
import type { AccessMode, ProviderOffering, ProviderSlug } from '@/lib/supabase/types';

export type SessionViabilityLevel = 'full_agent' | 'short_tasks' | 'one_shot';

export interface EffectiveLimits {
  rpmInt: number | null;
  rpdInt: number | null;
  tpmInt: number | null;
  tpdInt: number | null;
  rpmLabel: string;
  rpdLabel: string;
  quotaResetTz: string | null;
  quotaResetLabel: string | null;
}

export interface SessionViability {
  level: SessionViabilityLevel;
  label: string;
  reason: string;
}

const VIABILITY_ORDER: Record<SessionViabilityLevel, number> = {
  full_agent: 0,
  short_tasks: 1,
  one_shot: 2,
};

function findModelOverride(
  overrides: Record<string, ModelLimitOverride> | undefined,
  providerModelId: string
): ModelLimitOverride | null {
  if (!overrides) return null;
  const normalized = providerModelId.toLowerCase();
  let bestKey = '';
  let bestOverride: ModelLimitOverride | null = null;

  for (const [prefix, override] of Object.entries(overrides)) {
    const pLower = prefix.toLowerCase();
    if (normalized.startsWith(pLower) || normalized.includes(pLower)) {
      if (prefix.length > bestKey.length) {
        bestKey = prefix;
        bestOverride = override;
      }
    }
  }

  return bestOverride;
}

/**
 * Formats integer token/request limits cleanly (e.g. 12000 -> "12K", 50 -> "50").
 */
export function formatCompactNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return value.toLocaleString('en-US');
}

/**
 * Merges DB offering ints, matching per-model static overrides, and provider defaults.
 */
export function resolveEffectiveLimits(
  offering: Pick<
    ProviderOffering,
    'provider_slug' | 'provider_model_id' | 'rpm_limit' | 'rpd_limit' | 'rpm_int' | 'rpd_int' | 'tpm_int' | 'tpd_int' | 'quota_reset_tz'
  >
): EffectiveLimits {
  const cfg = getProvidersConfig()[offering.provider_slug as ProviderSlug];
  const override = findModelOverride(cfg?.model_limit_overrides, offering.provider_model_id);

  const rpmInt = offering.rpm_int ?? override?.rpm_int ?? cfg?.rpm_int ?? null;
  const rpdInt = offering.rpd_int ?? override?.rpd_int ?? cfg?.rpd_int ?? null;
  const tpmInt = offering.tpm_int ?? override?.tpm_int ?? cfg?.tpm_int ?? null;
  const tpdInt = offering.tpd_int ?? override?.tpd_int ?? cfg?.tpd_int ?? null;

  return {
    rpmInt,
    rpdInt,
    tpmInt,
    tpdInt,
    rpmLabel: override?.rpm_limit ?? offering.rpm_limit ?? cfg?.rpm_limit ?? 'Free tier cap',
    rpdLabel: override?.rpd_limit ?? offering.rpd_limit ?? cfg?.rpd_limit ?? 'Free tier cap',
    quotaResetTz: offering.quota_reset_tz ?? cfg?.quota_reset_tz ?? null,
    quotaResetLabel: cfg?.quota_reset_label ?? null,
  };
}

/**
 * Classifies whether a free offering can sustain multi-turn autonomous coding loops
 * (`Full Agent Loop`), bounded sessions (`Short Tasks`), or only quick prompts (`1-Shot Chat`).
 */
export function computeSessionViability(offering: ProviderOffering): SessionViability {
  const limits = resolveEffectiveLimits(offering);
  const { rpmInt, rpdInt, tpmInt, tpdInt } = limits;

  if (rpdInt !== null && rpdInt <= 50) {
    return {
      level: 'one_shot',
      label: '1-Shot Chat',
      reason: `Tight daily cap (${formatCompactNumber(rpdInt)} RPD)`,
    };
  }
  if (tpmInt !== null && tpmInt < 8_000) {
    return {
      level: 'one_shot',
      label: '1-Shot Chat',
      reason: `Low throughput cap (${formatCompactNumber(tpmInt)} TPM)`,
    };
  }
  if (tpdInt !== null && tpdInt < 50_000) {
    return {
      level: 'one_shot',
      label: '1-Shot Chat',
      reason: `Small daily token budget (${formatCompactNumber(tpdInt)} TPD)`,
    };
  }

  if (
    offering.tier_type === 'always_free' &&
    (rpdInt === null || rpdInt >= 250) &&
    (rpmInt === null || rpmInt >= 10) &&
    (tpmInt === null || tpmInt >= 25_000) &&
    (tpdInt === null || tpdInt >= 250_000)
  ) {
    return {
      level: 'full_agent',
      label: 'Full Agent Loop',
      reason: `Always-free with ${limits.rpmLabel} & ${limits.rpdLabel}`,
    };
  }

  const qualifier =
    offering.tier_type === 'trial_credit'
      ? 'Finite one-time credit pool'
      : tpdInt !== null && tpdInt < 250_000
        ? `Bounded daily budget (${formatCompactNumber(tpdInt)} TPD)`
        : tpmInt !== null && tpmInt < 25_000
          ? `Bounded burst rate (${formatCompactNumber(tpmInt)} TPM)`
          : `${limits.rpmLabel} · ${limits.rpdLabel}`;

  return {
    level: 'short_tasks',
    label: 'Short Tasks',
    reason: qualifier,
  };
}

/**
 * Picks the strongest offering and viability rating for a model (preferring always-free).
 */
export function getBestModelViability(
  offerings: ProviderOffering[]
): { viability: SessionViability; offering: ProviderOffering } | null {
  if (offerings.length === 0) return null;
  const sorted = sortProviderOfferings(offerings);
  const top = sorted[0];
  if (!top) return null;
  return {
    offering: top,
    viability: computeSessionViability(top),
  };
}

/**
 * Returns whether a provider exposes a general standalone REST API (`direct_api`) or
 * free models intended for a specific coding-agent harness (`harness_only`).
 */
export function getProviderAccessMode(slug: ProviderSlug): {
  accessMode: AccessMode;
  harnessName: string | null;
} {
  const cfg = getProvidersConfig()[slug];
  return {
    accessMode: cfg?.access_mode ?? 'direct_api',
    harnessName: cfg?.harness_name ?? null,
  };
}

/**
 * Deterministically orders offerings:
 * 1. Always-Free + Zero-Training
 * 2. Always-Free + Trains-on-Data
 * 3. Trial-Credit + Zero-Training
 * 4. Trial-Credit + Trains-on-Data
 * Within each band, Direct API endpoints rank ahead of Harness-Only endpoints,
 * then stronger Session Viability (`full_agent` > `short_tasks` > `one_shot`), then slug.
 */
export function sortProviderOfferings(offerings: ProviderOffering[]): ProviderOffering[] {
  return [...offerings].sort((a, b) => {
    const aTierRank = (a.tier_type === 'trial_credit' ? 2 : 0) + (a.trains_on_data ? 1 : 0);
    const bTierRank = (b.tier_type === 'trial_credit' ? 2 : 0) + (b.trains_on_data ? 1 : 0);
    if (aTierRank !== bTierRank) return aTierRank - bTierRank;

    const aAccessRank = getProviderAccessMode(a.provider_slug).accessMode === 'harness_only' ? 1 : 0;
    const bAccessRank = getProviderAccessMode(b.provider_slug).accessMode === 'harness_only' ? 1 : 0;
    if (aAccessRank !== bAccessRank) return aAccessRank - bAccessRank;

    const aViability = VIABILITY_ORDER[computeSessionViability(a).level];
    const bViability = VIABILITY_ORDER[computeSessionViability(b).level];
    if (aViability !== bViability) return aViability - bViability;

    return a.provider_slug.localeCompare(b.provider_slug);
  });
}

/**
 * Computes human-readable countdown ("Resets in Xh Ym") until next midnight in `resetTz`.
 */
export function getNextResetCountdown(
  resetTz: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!resetTz) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resetTz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const minutePart = parts.find((p) => p.type === 'minute')?.value;
    const hour = Number(hourPart);
    const minute = Number(minutePart);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    const normalizedHour = hour === 24 ? 0 : hour;
    const elapsedMinutes = normalizedHour * 60 + minute;
    const remainingMinutes = (24 * 60 - elapsedMinutes) % (24 * 60);
    const safeRemaining = remainingMinutes === 0 ? 24 * 60 : remainingMinutes;
    const hrs = Math.floor(safeRemaining / 60);
    const mins = safeRemaining % 60;
    return `Resets in ${hrs}h ${mins}m`;
  } catch {
    return null;
  }
}
