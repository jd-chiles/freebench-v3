import type { AvailabilityEventRecord, LeaderboardModel } from '@/lib/supabase/types';

export const MY_STACK_STORAGE_KEY = 'freebench:my-stack';

export interface PinnedStackItem {
  canonicalId: string;
  displayName: string;
  pinnedScore: number | null;
  pinnedAt: string;
}

export interface PinnedStackAlert {
  item: PinnedStackItem;
  status: 'healthy' | 'dropped' | 'overtaken';
  currentModel: LeaderboardModel | null;
  replacement: LeaderboardModel | null;
  latestDropEvent: AvailabilityEventRecord | null;
  reason: string;
}

/**
 * Loads pinned "My Stack" models from localStorage safely.
 */
export function loadMyStack(): PinnedStackItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MY_STACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const items: PinnedStackItem[] = [];

    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      if (typeof obj.canonicalId !== 'string' || !obj.canonicalId || seen.has(obj.canonicalId)) {
        continue;
      }
      seen.add(obj.canonicalId);
      items.push({
        canonicalId: obj.canonicalId,
        displayName:
          typeof obj.displayName === 'string' && obj.displayName ? obj.displayName : obj.canonicalId,
        pinnedScore: typeof obj.pinnedScore === 'number' ? obj.pinnedScore : null,
        pinnedAt:
          typeof obj.pinnedAt === 'string' ? obj.pinnedAt : new Date().toISOString(),
      });
    }

    return items;
  } catch {
    return [];
  }
}

/**
 * Persists pinned "My Stack" models to localStorage.
 */
export function saveMyStack(items: PinnedStackItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MY_STACK_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota / private mode failures.
  }
}

/**
 * Toggles a model inside the user's pinned stack array.
 */
export function togglePinnedModel(
  stack: PinnedStackItem[],
  model: Pick<LeaderboardModel, 'canonical_id' | 'display_name' | 'freebench_score'>,
  nowIso: string = new Date().toISOString()
): PinnedStackItem[] {
  const exists = stack.some((item) => item.canonicalId === model.canonical_id);
  if (exists) {
    return stack.filter((item) => item.canonicalId !== model.canonical_id);
  }
  return [
    ...stack,
    {
      canonicalId: model.canonical_id,
      displayName: model.display_name,
      pinnedScore: model.freebench_score,
      pinnedAt: nowIso,
    },
  ];
}

/**
 * Compares pinned models against current live rankings and availability events to
 * surface dropped models or Always-Free alternatives outscoring the pin by >= 3.0 points.
 */
export function analyzePinnedStackStatus(
  stack: PinnedStackItem[],
  liveModels: LeaderboardModel[],
  events: AvailabilityEventRecord[] = []
): PinnedStackAlert[] {
  const byId = new Map(liveModels.map((m) => [m.canonical_id, m]));
  const bestAlwaysFree = [...liveModels]
    .filter(
      (m) =>
        m.freebench_score !== null &&
        m.providers.some((p) => p.tier_type === 'always_free')
    )
    .sort((a, b) => (b.freebench_score ?? -1) - (a.freebench_score ?? -1))[0] ?? null;

  return stack.map((item) => {
    const current = byId.get(item.canonicalId) ?? null;
    const latestDrop =
      events.find(
        (evt) =>
          evt.canonical_id === item.canonicalId &&
          (evt.event_type === 'model_dropped' || evt.event_type === 'quota_changed')
      ) ?? null;

    if (!current || current.providers.length === 0) {
      return {
        item,
        status: 'dropped',
        currentModel: null,
        replacement: bestAlwaysFree,
        latestDropEvent: latestDrop,
        reason: 'No active free-tier provider currently serving this model.',
      };
    }

    const currentScore = current.freebench_score ?? item.pinnedScore;
    if (
      bestAlwaysFree &&
      bestAlwaysFree.canonical_id !== item.canonicalId &&
      bestAlwaysFree.freebench_score !== null &&
      currentScore !== null &&
      bestAlwaysFree.freebench_score - currentScore >= 3.0
    ) {
      const gap = (bestAlwaysFree.freebench_score - currentScore).toFixed(1);
      return {
        item,
        status: 'overtaken',
        currentModel: current,
        replacement: bestAlwaysFree,
        latestDropEvent: latestDrop,
        reason: `${bestAlwaysFree.display_name} scores +${gap} higher on Always-Free tiers.`,
      };
    }

    return {
      item,
      status: 'healthy',
      currentModel: current,
      replacement: null,
      latestDropEvent: latestDrop,
      reason: `Active on ${current.providers.length} free provider${
        current.providers.length === 1 ? '' : 's'
      }.`,
    };
  });
}
