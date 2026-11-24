'use client';

import { useEffect, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

export function MethodologyModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
      >
        <HelpCircle className="h-3.5 w-3.5 text-emerald-400" />
        <span>Methodology</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="FreeBench Scoring Methodology"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-zinc-100">
                  FreeBench Scoring Methodology
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Independent benchmarks combined with live free-tier availability.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close methodology"
                className="rounded border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-zinc-300">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="font-mono text-[11px] font-semibold uppercase text-emerald-400">
                  FreeBench Composite (0–100)
                </div>
                <p className="mt-1 text-zinc-400">
                  Cohort z-score standardized weighted average of{' '}
                  <strong className="text-zinc-200">40% Epoch ECI</strong> (dynamically anchored
                  to cohort max) + <strong className="text-zinc-200">35% LiveBench Global</strong>{' '}
                  + <strong className="text-zinc-200">25% BFCL Tool Calling</strong>. Partial
                  coverage applies Bayesian shrinkage (<code className="text-zinc-200">λ = 0.25</code>{' '}
                  toward 50) so 1-pillar models cannot game{' '}
                  <strong className="text-zinc-200">#1</strong>; only models with{' '}
                  <code className="text-zinc-200">2/3+</code> coverage qualify for top leader
                  badges.
                </p>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="font-mono text-[11px] font-semibold uppercase text-cyan-400">
                  Agentic Coding Score (0–100)
                </div>
                <p className="mt-1 text-zinc-400">
                  Tailored for coding loops (OpenCode, Kilo Code, Hermes, Cline, Aider):{' '}
                  <strong className="text-zinc-200">30% SWE-bench Verified</strong> +{' '}
                  <strong className="text-zinc-200">25% Aider Polyglot</strong> +{' '}
                  <strong className="text-zinc-200">20% LiveBench Coding</strong> +{' '}
                  <strong className="text-zinc-200">15% BFCL Tool Use</strong> +{' '}
                  <strong className="text-zinc-200">5% Reasoning</strong> +{' '}
                  <strong className="text-zinc-200">5% Context Headroom</strong>. Models without
                  tool calling are excluded.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 pt-1 font-mono text-[11px] text-zinc-400">
                <a
                  href="https://epoch.ai/data/notable-ai-models"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-emerald-400"
                >
                  Epoch AI ECI ↗
                </a>
                <a
                  href="https://livebench.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-emerald-400"
                >
                  LiveBench ↗
                </a>
                <a
                  href="https://gorilla.cs.berkeley.edu/leaderboard.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-emerald-400"
                >
                  BFCL ↗
                </a>
                <a
                  href="https://aider.chat/docs/leaderboards/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-emerald-400"
                >
                  Aider Polyglot ↗
                </a>
                <a
                  href="https://www.swebench.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-emerald-400"
                >
                  SWE-bench Verified ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
