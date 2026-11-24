import { formatErrorMessage } from '@/lib/providers/http';
import { pollAiderPolyglot } from './aider';
import { pollBfcl } from './bfcl';
import { pollEpochBenchmarks } from './epoch';
import { pollLiveBench } from './livebench';
import { pollSweBenchVerified } from './swebench';
import type { BenchmarkPollResult, BenchmarkSource } from './types';

export {
  pollAiderPolyglot,
  pollEpochBenchmarks,
  pollLiveBench,
  pollBfcl,
  pollSweBenchVerified,
};

const BENCHMARK_POLLERS: ReadonlyArray<{
  source: BenchmarkSource;
  run: () => Promise<BenchmarkPollResult>;
}> = [
  { source: 'epoch', run: pollEpochBenchmarks },
  { source: 'livebench', run: pollLiveBench },
  { source: 'bfcl', run: pollBfcl },
  { source: 'aider', run: pollAiderPolyglot },
  { source: 'swebench', run: pollSweBenchVerified },
];

/**
 * Executes all 5 benchmark ingestors concurrently via `Promise.allSettled`.
 */
export async function pollAllBenchmarks(): Promise<BenchmarkPollResult[]> {
  const settled = await Promise.allSettled(BENCHMARK_POLLERS.map((entry) => entry.run()));

  return settled.map((outcome, idx) => {
    const source = BENCHMARK_POLLERS[idx]?.source ?? 'epoch';
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    return {
      source,
      ok: false,
      observations: [],
      error: formatErrorMessage(outcome.reason),
      duration_ms: 0,
    };
  });
}
