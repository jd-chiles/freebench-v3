import { Activity, AlertTriangle } from 'lucide-react';
import type { ProviderOffering } from '@/lib/supabase/types';

interface EndpointHealthBadgeProps {
  offering: ProviderOffering;
}

/**
 * Displays verified canary probe telemetry (7d uptime, TTFT, tok/s) and
 * crowdsourced 24h 429 pressure signals when recorded.
 */
export function EndpointHealthBadge({ offering }: EndpointHealthBadgeProps) {
  const hasTelemetry =
    typeof offering.uptime_7d === 'number' ||
    typeof offering.ttft_ms === 'number' ||
    typeof offering.tokens_per_sec === 'number' ||
    (offering.rate_limit_reports_24h ?? 0) > 0;

  if (!hasTelemetry) return null;

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
      {typeof offering.uptime_7d === 'number' ? (
        <span
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
            offering.uptime_7d >= 95
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
              : offering.uptime_7d >= 80
                ? 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
          }`}
        >
          <Activity className="h-2.5 w-2.5" />
          <span>{offering.uptime_7d.toFixed(0)}% 7d</span>
        </span>
      ) : null}

      {typeof offering.ttft_ms === 'number' ? (
        <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-300">
          {offering.ttft_ms}ms TTFT
        </span>
      ) : null}

      {typeof offering.tokens_per_sec === 'number' ? (
        <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-300">
          {offering.tokens_per_sec.toFixed(0)} tok/s
        </span>
      ) : null}

      {(offering.rate_limit_reports_24h ?? 0) >= 3 ? (
        <span
          className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-amber-200"
          title="Crowdsourced HTTP 429 reports in the past 24 hours"
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          <span>{offering.rate_limit_reports_24h}× 429 (24h)</span>
        </span>
      ) : null}
    </div>
  );
}
