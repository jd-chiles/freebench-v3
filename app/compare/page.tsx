import type { Metadata } from 'next';
import { CompareClient } from '@/components/compare/CompareClient';
import { getLeaderboardData } from '@/lib/data/queries';

export const revalidate = 21600;

export const metadata: Metadata = {
  title: 'Compare Free LLMs Side-by-Side',
  description:
    'Compare up to 4 free-tier LLMs across Epoch AI ECI, LiveBench Coding/Reasoning/Math, BFCL tool calling, context window, and free provider rate limits.',
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ models?: string }>;
}) {
  const { models: rawModelsParam } = await searchParams;
  const initialIds = rawModelsParam
    ? rawModelsParam
        .split(',')
        .map((s) => decodeURIComponent(s.trim()))
        .filter(Boolean)
    : [];

  const { models } = await getLeaderboardData();

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
          Side-by-Side Model Comparison
        </h1>
        <p className="text-sm text-zinc-400">
          Compare benchmark scores, context windows, privacy guarantees, and active free-tier
          providers for up to 4 models.
        </p>
      </section>

      <CompareClient allModels={models} initialIds={initialIds} />
    </div>
  );
}
