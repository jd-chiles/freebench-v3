import { formatCompactNumber, resolveEffectiveLimits } from '@/lib/providers/limits';
import type { LeaderboardScope, SortCategory } from '@/lib/leaderboard/url-state';
import type { LeaderboardModel, ProviderOffering } from '@/lib/supabase/types';

export interface BenchmarkSignal {
  key: 'eci' | 'lb' | 'coding' | 'reasoning' | 'math' | 'bfcl' | 'swe' | 'aider';
  label: string;
  shortLabel: string;
  value: number;
  formatted: string;
  category: SortCategory;
}

const TINY_UNRANKED_CONTEXT_THRESHOLD = 16_000;

/**
 * Returns true if the model has a composite FreeBench score or at least one benchmark pillar.
 */
export function isRankedModel(model: LeaderboardModel): boolean {
  return model.freebench_score !== null || model.benchmark_coverage > 0;
}

/**
 * Identifies low-signal unranked models (legacy LoRA adapters or tiny <16K context models)
 * so they can be tucked behind a toggle without hiding ranked models or search matches.
 */
export function isLegacyOrTinyModel(model: LeaderboardModel): boolean {
  if (isRankedModel(model)) {
    return false;
  }

  const lowerId = model.canonical_id.toLowerCase();
  const lowerName = model.display_name.toLowerCase();
  if (lowerId.endsWith('-lora') || /\blora\b/.test(lowerId) || /\blora\b/.test(lowerName)) {
    return true;
  }

  return (
    model.context_window !== null &&
    model.context_window > 0 &&
    model.context_window < TINY_UNRANKED_CONTEXT_THRESHOLD
  );
}

/**
 * Extracts only populated benchmark signals for a model in priority order,
 * eliminating sparse "—" placeholders in the default leaderboard view.
 */
export function extractBenchmarkSignals(
  model: LeaderboardModel,
  maxCount = 4
): BenchmarkSignal[] {
  const candidates: Array<BenchmarkSignal | null> = [
    model.eci_score !== null
      ? {
          key: 'eci',
          label: 'Epoch ECI',
          shortLabel: 'ECI',
          value: model.eci_score,
          formatted: model.eci_score.toFixed(1),
          category: 'overall',
        }
      : null,
    model.livebench_global !== null
      ? {
          key: 'lb',
          label: 'LiveBench',
          shortLabel: 'LB',
          value: model.livebench_global,
          formatted: model.livebench_global.toFixed(1),
          category: 'overall',
        }
      : null,
    model.bfcl_overall !== null
      ? {
          key: 'bfcl',
          label: 'BFCL Tools',
          shortLabel: 'BFCL',
          value: model.bfcl_overall,
          formatted: model.bfcl_overall.toFixed(1),
          category: 'tools',
        }
      : null,
    model.swebench_verified !== null && model.swebench_verified !== undefined
      ? {
          key: 'swe',
          label: 'SWE-bench',
          shortLabel: 'SWE',
          value: model.swebench_verified,
          formatted: model.swebench_verified.toFixed(1),
          category: 'agentic',
        }
      : null,
    model.aider_polyglot !== null && model.aider_polyglot !== undefined
      ? {
          key: 'aider',
          label: 'Aider Polyglot',
          shortLabel: 'Aider',
          value: model.aider_polyglot,
          formatted: model.aider_polyglot.toFixed(1),
          category: 'agentic',
        }
      : null,
    model.livebench_coding !== null
      ? {
          key: 'coding',
          label: 'LB Coding',
          shortLabel: 'Code',
          value: model.livebench_coding,
          formatted: model.livebench_coding.toFixed(1),
          category: 'coding',
        }
      : null,
    model.livebench_reasoning !== null
      ? {
          key: 'reasoning',
          label: 'LB Reasoning',
          shortLabel: 'Reason',
          value: model.livebench_reasoning,
          formatted: model.livebench_reasoning.toFixed(1),
          category: 'reasoning',
        }
      : null,
    model.livebench_math !== null
      ? {
          key: 'math',
          label: 'LB Math',
          shortLabel: 'Math',
          value: model.livebench_math,
          formatted: model.livebench_math.toFixed(1),
          category: 'math',
        }
      : null,
  ];

  return candidates.filter((item): item is BenchmarkSignal => item !== null).slice(0, maxCount);
}

/**
 * Formats a concise single-line free rate/quota summary for the primary provider offering.
 */
export function getPrimaryLimitsSummary(offering: ProviderOffering): string {
  const limits = resolveEffectiveLimits(offering);
  const parts: string[] = [];

  if (limits.rpmInt && limits.rpmInt > 0) {
    parts.push(`${limits.rpmInt} RPM`);
  } else if (offering.rpm_limit && offering.rpm_limit !== '—') {
    parts.push(offering.rpm_limit);
  }

  if (limits.rpdInt && limits.rpdInt > 0) {
    parts.push(`${formatCompactNumber(limits.rpdInt)}/d`);
  } else if (limits.tpdInt && limits.tpdInt > 0) {
    parts.push(`${formatCompactNumber(limits.tpdInt)} tok/d`);
  } else if (offering.rpd_limit && offering.rpd_limit !== '—') {
    parts.push(offering.rpd_limit);
  } else if (limits.tpmInt && limits.tpmInt > 0) {
    parts.push(`${formatCompactNumber(limits.tpmInt)} TPM`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Limits vary';
}

/**
 * Returns a human-readable classification and explanation for why a model lacks benchmark scores.
 */
export function getUnrankedReason(model: LeaderboardModel): {
  badge: string;
  detail: string;
} {
  const combined = `${model.canonical_id} ${model.display_name}`.toLowerCase();
  const isStealthOrPreview =
    /\b(stealth|cloak|alpha|beta|preview|exp|experimental)\b/.test(combined) ||
    model.providers.some((p) => p.provider_model_id.toLowerCase().includes('openrouter/'));

  if (isStealthOrPreview) {
    return {
      badge: 'Stealth / Preview',
      detail:
        'Early-access or stealth model available for free inference, not yet indexed on Epoch ECI, LiveBench, or BFCL.',
    };
  }

  if (isLegacyOrTinyModel(model)) {
    return {
      badge: 'Legacy / Edge',
      detail:
        'Legacy fine-tune or compact-context model outside standard frontier benchmark suites.',
    };
  }

  return {
    badge: 'Awaiting Eval',
    detail:
      'Active free endpoint ready to use now; awaiting coverage on Epoch ECI, LiveBench, or BFCL.',
  };
}

/**
 * Filters a model list by leaderboard scope (`ranked`, `unranked`, or `all`).
 */
export function matchesLeaderboardScope(
  model: LeaderboardModel,
  scope: LeaderboardScope
): boolean {
  if (scope === 'all') return true;
  const ranked = isRankedModel(model);
  return scope === 'ranked' ? ranked : !ranked;
}
