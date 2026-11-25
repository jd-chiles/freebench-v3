import Link from 'next/link';

/**
 * Branded 404 page for missing models, providers, or routes.
 */
export default function NotFound() {
  return (
    <div className="mx-auto my-12 max-w-lg rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
      <div className="font-mono text-xs font-semibold uppercase tracking-wider text-emerald-400">
        404 · Not Found
      </div>
      <h1 className="mt-2 text-2xl font-bold text-zinc-50">Model or page not found</h1>
      <p className="mt-2 text-sm text-zinc-400">
        The requested model, provider, or route does not exist or is no longer active on free tiers.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Back to Leaderboard
        </Link>
        <Link
          href="/status"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-xs font-medium text-zinc-200 hover:border-zinc-600"
        >
          System Status
        </Link>
      </div>
    </div>
  );
}
