'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getNextResetCountdown } from '@/lib/providers/limits';

interface ResetCountdownProps {
  resetTz: string | null | undefined;
  fallbackLabel?: string | null;
}

/**
 * Hydration-safe daily quota reset countdown rendered on the client after mount.
 */
export function ResetCountdown({ resetTz, fallbackLabel }: ResetCountdownProps) {
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    if (!resetTz) return;
    const update = () => setCountdown(getNextResetCountdown(resetTz));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [resetTz]);

  const text = countdown ?? fallbackLabel ?? null;
  if (!text) return null;

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-400">
      <Clock className="h-3 w-3 text-zinc-400" />
      <span>{text}</span>
    </span>
  );
}
