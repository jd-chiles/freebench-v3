'use client';

import Link from 'next/link';

/**
 * Client-side error recovery boundary that avoids leaking internal details.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto my-12 max-w-lg rounded-xl border border-rose-500/30 bg-zinc-900/70 p-8 text-center">
      <div className="font-mono text-xs font-semibold uppercase tracking-wider text-rose-400">
        Something went wrong
      </div>
      <h1 className="mt-2 text-2xl font-bold text-zinc-50">Unable to load this view</h1>
      <p className="mt-2 text-sm text-zinc-400">
        A temporary rendering or data error occurred. You can retry or return to the live leaderboard.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-xs font-medium text-zinc-200 hover:border-zinc-600"
        >
          Back to Leaderboard
        </Link>
      </div>
    </div>
  );
}
