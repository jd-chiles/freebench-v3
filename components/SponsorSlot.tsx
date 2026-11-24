import Script from 'next/script';
import { ExternalLink } from 'lucide-react';
import { getActiveSponsor } from '@/lib/data/queries';

/**
 * Config-gated native sponsorship slot. Renders nothing until either
 * `config/sponsors.json` defines `active_sponsor` or `NEXT_PUBLIC_ETHICAL_ADS_PUBLISHER` is set.
 */
export function SponsorSlot() {
  const sponsor = getActiveSponsor();
  const ethicalAdsPublisher = process.env.NEXT_PUBLIC_ETHICAL_ADS_PUBLISHER?.trim();

  if (!sponsor && !ethicalAdsPublisher) {
    return null;
  }

  if (sponsor) {
    return (
      <aside
        aria-label="Sponsored partner"
        className="flex flex-col justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 sm:flex-row sm:items-center"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            {sponsor.badge ?? 'Sponsored'}
          </span>
          <div>
            <div className="text-xs font-semibold text-zinc-100">{sponsor.name}</div>
            <p className="text-xs text-zinc-400">{sponsor.tagline}</p>
          </div>
        </div>
        <a
          href={sponsor.url}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
        >
          <span>{sponsor.cta_label}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </aside>
    );
  }

  return (
    <aside aria-label="Developer sponsorship" className="my-2">
      <div
        data-ea-publisher={ethicalAdsPublisher}
        data-ea-type="text"
        className="dark bordered"
      />
      <Script
        async
        src="https://media.ethicalads.io/media/client/ethicalads.min.js"
        strategy="lazyOnload"
      />
    </aside>
  );
}
