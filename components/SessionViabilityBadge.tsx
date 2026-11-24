import type { SessionViability } from '@/lib/providers/limits';

interface SessionViabilityBadgeProps {
  viability: SessionViability;
  compact?: boolean;
}

const STYLE_MAP: Record<SessionViability['level'], string> = {
  full_agent: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-300',
  short_tasks: 'border-cyan-500/40 bg-cyan-500/12 text-cyan-300',
  one_shot: 'border-zinc-700 bg-zinc-900 text-zinc-300',
};

/**
 * Displays whether a free-tier offering supports full agent loops, short tasks, or 1-shot chat.
 */
export function SessionViabilityBadge({
  viability,
  compact = false,
}: SessionViabilityBadgeProps) {
  return (
    <span
      aria-label={`${viability.label}: ${viability.reason}`}
      title={`${viability.label} — ${viability.reason}`}
      className={`inline-flex items-center gap-1 rounded border font-mono ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      } ${STYLE_MAP[viability.level]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          viability.level === 'full_agent'
            ? 'bg-emerald-400'
            : viability.level === 'short_tasks'
              ? 'bg-cyan-400'
              : 'bg-zinc-400'
        }`}
      />
      <span>{viability.label}</span>
    </span>
  );
}
