import Link from 'next/link';
import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';
import { NewsletterSignup } from './NewsletterSignup';

export function Footer() {
  const providersConfig = getProvidersConfig();
  const providerSlugs = Object.keys(providersConfig) as ProviderSlug[];

  return (
    <footer className="mt-12 border-t border-zinc-800/80 bg-zinc-950">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <span className="flex h-6 w-6 items-center justify-center rounded border border-emerald-500/40 bg-emerald-500/15 font-mono text-[11px] font-bold text-emerald-400">
              FB
            </span>
            <span>FreeBench v0.0.1</span>
          </div>
          <p className="text-xs leading-relaxed text-zinc-400">
            Live availability across {providerSlugs.length} free-tier LLM APIs paired with
            independent Epoch AI, LiveBench, and BFCL evaluations.
          </p>
          <div className="flex flex-wrap gap-3 pt-1 font-mono text-[11px] text-zinc-500">
            <Link href="/feed.xml" className="hover:text-zinc-300">
              RSS Feed
            </Link>
            <Link href="/llms.txt" className="hover:text-zinc-300">
              llms.txt
            </Link>
            <Link href="/api/v1/models" className="hover:text-zinc-300">
              JSON API
            </Link>
            <Link href="/sitemap.xml" className="hover:text-zinc-300">
              Sitemap
            </Link>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Best Free By Task
          </h3>
          <ul className="space-y-1.5 text-xs text-zinc-400">
            <li>
              <Link href="/best/agentic-coding" className="hover:text-emerald-400">
                Agentic Coding (OpenCode / Kilo / Hermes)
              </Link>
            </li>
            <li>
              <Link href="/best/coding" className="hover:text-emerald-400">
                Coding & Engineering
              </Link>
            </li>
            <li>
              <Link href="/best/reasoning" className="hover:text-emerald-400">
                Reasoning
              </Link>
            </li>
            <li>
              <Link href="/best/tool-calling" className="hover:text-emerald-400">
                Tool Calling (BFCL)
              </Link>
            </li>
            <li>
              <Link href="/best/always-free" className="hover:text-emerald-400">
                Always Free Only
              </Link>
            </li>
            <li>
              <Link href="/best/privacy" className="hover:text-emerald-400">
                Zero Data Training
              </Link>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Free Providers ({providerSlugs.length})
          </h3>
          <ul className="grid grid-cols-2 gap-1.5 text-xs text-zinc-400">
            {providerSlugs.map((slug) => (
              <li key={slug}>
                <Link href={`/providers/${slug}`} className="hover:text-emerald-400">
                  {providersConfig[slug].display_name.replace(' (Free)', '')}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <NewsletterSignup />
      </div>
    </footer>
  );
}
