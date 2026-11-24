import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Footer } from '@/components/Footer';
import { Navbar } from '@/components/Navbar';
import { getLeaderboardData } from '@/lib/data/queries';
import { getProvidersConfig } from '@/lib/providers/types';
import './globals.css';

const PROVIDER_COUNT = Object.keys(getProvidersConfig()).length;

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const SITE_URL = process.env.SITE_URL?.trim() || 'https://freebench.dev';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'FreeBench — Best Free LLMs Right Now (Live Benchmarks & Free APIs)',
    template: '%s | FreeBench',
  },
  description:
    `Live open-source leaderboard pairing verified free-tier LLM API availability across ${PROVIDER_COUNT} providers with Epoch AI, LiveBench, and BFCL benchmarks.`,
  keywords: [
    'best free LLM',
    'free LLM API',
    'free AI API',
    'free coding LLM',
    'agentic coding LLM free',
    'OpenRouter free models',
    'Groq free models',
    'Cerebras free API',
    'LiveBench',
    'BFCL',
  ],
  openGraph: {
    type: 'website',
    siteName: 'FreeBench',
    title: 'FreeBench — Best Free LLMs Right Now',
    description:
      `Find the strongest free-to-use LLM APIs verified live every 6 hours across ${PROVIDER_COUNT} providers and independent benchmarks.`,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FreeBench — Best Free LLMs Right Now',
    description:
      'Live free-tier LLM availability + Epoch ECI, LiveBench, and BFCL benchmarks.',
  },
  alternates: {
    types: {
      'application/rss+xml': `${SITE_URL}/feed.xml`,
    },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cfBeaconToken = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN?.trim();
  const { latestSync, isDemoData } = await getLeaderboardData();

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        <div className="flex min-h-screen flex-col">
          <Navbar
            isDemoData={isDemoData}
            latestSyncAt={latestSync?.completed_at ?? latestSync?.started_at ?? null}
            latestStatus={latestSync?.status ?? null}
          />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
          <Footer />
        </div>
        <Analytics />
        <SpeedInsights />
        {cfBeaconToken ? (
          <Script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: cfBeaconToken })}
          />
        ) : null}
      </body>
    </html>
  );
}
