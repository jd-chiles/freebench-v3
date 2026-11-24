import { ExternalLink, Wallet } from 'lucide-react';
import {
  estimateAgent100TurnCostUsd,
  getPaidEscapeHatch,
} from '@/lib/pricing/escape-hatch';

interface PaidEscapeHatchCardProps {
  canonicalId: string;
  displayName: string;
}

/**
 * Transparent comparison showing the cheapest paid pay-as-you-go API escape hatch
 * if a developer outgrows daily free-tier limits.
 */
export function PaidEscapeHatchCard({
  canonicalId,
  displayName,
}: PaidEscapeHatchCardProps) {
  const options = getPaidEscapeHatch(canonicalId);
  if (options.length === 0) return null;

  return (
    <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Wallet className="h-4 w-4 text-amber-400" />
          <span>Outgrowing Free Quotas? Cheapest Paid Escape Hatch</span>
        </div>
        <span className="font-mono text-[10px] text-zinc-400">
          Est. 100-turn agent loop (~500K in / 50K out)
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const estUsd = estimateAgent100TurnCostUsd(opt);
          return (
            <a
              key={`${canonicalId}-${opt.provider}`}
              href={opt.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-3 transition-colors hover:border-amber-500/40"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                  <span>{opt.provider}</span>
                  <ExternalLink className="h-3 w-3 text-zinc-400" />
                </div>
                <div className="font-mono text-[11px] text-zinc-400">
                  ${opt.input_per_1m_usd.toFixed(2)} / ${opt.output_per_1m_usd.toFixed(2)} per 1M
                  in/out
                </div>
                <div className="font-mono text-[10px] text-zinc-400">
                  Verified {opt.last_verified} · {displayName}
                </div>
              </div>

              <div className="shrink-0 text-right font-mono">
                <div className="text-sm font-bold text-amber-300">~${estUsd.toFixed(2)}</div>
                <div className="text-[10px] text-zinc-400">/100 turns</div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
