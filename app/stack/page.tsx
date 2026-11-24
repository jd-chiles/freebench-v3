import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { StackBuilderClient } from '@/components/stack/StackBuilderClient';
import { getLeaderboardData } from '@/lib/data/queries';

export const revalidate = 21600;

export const metadata: Metadata = {
  title: 'Free LLM Fallback Stack Builder (LiteLLM, OpenCode & OpenRouter)',
  description:
    'Combine multiple zero-cost LLM providers into a self-healing failover stack with 429 cooldown routing for LiteLLM, OpenCode, and TypeScript.',
};

export default async function StackBuilderPage() {
  const { models } = await getLeaderboardData();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Leaderboard</span>
        </Link>
      </div>

      <section className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
          Multi-Provider Free Fallback Stack Builder
        </h1>
        <p className="max-w-3xl text-sm text-zinc-400">
          One free provider rate-limits quickly during long coding loops. Select the free keys you
          already have (or start with the 4 keyless endpoints) to generate a multi-provider 429
          failover config you can paste straight into LiteLLM, OpenCode, or TypeScript.
        </p>
      </section>

      <StackBuilderClient models={models} />
    </div>
  );
}
