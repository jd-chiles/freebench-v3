interface ScoreBarProps {
  value: number | null | undefined;
  accent?: 'emerald' | 'cyan' | 'amber' | 'violet';
  digits?: number;
}

const ACCENT_CLASSES: Record<NonNullable<ScoreBarProps['accent']>, string> = {
  emerald: 'bg-emerald-500',
  cyan: 'bg-cyan-400',
  amber: 'bg-amber-400',
  violet: 'bg-violet-400',
};

export function ScoreBar({ value, accent = 'emerald', digits = 1 }: ScoreBarProps) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return <span className="font-mono text-xs text-zinc-400">—</span>;
  }

  const widthPct = Math.max(2, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-right font-mono text-xs font-semibold tabular-nums text-zinc-100">
        {value.toFixed(digits)}
      </span>
      <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-zinc-800 sm:block">
        <div
          className={`h-full rounded-full ${ACCENT_CLASSES[accent]}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}
