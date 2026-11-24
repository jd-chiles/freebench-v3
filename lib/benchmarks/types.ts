import { z } from 'zod';
import benchmarksRaw from '@/config/benchmarks.json';

export type BenchmarkSource = 'epoch' | 'livebench' | 'bfcl' | 'aider' | 'swebench';

export type BenchmarkMetricKey =
  | 'eci_score'
  | 'livebench_global'
  | 'livebench_coding'
  | 'livebench_reasoning'
  | 'livebench_math'
  | 'livebench_if'
  | 'livebench_data'
  | 'bfcl_overall'
  | 'aider_polyglot'
  | 'swebench_verified';

export interface BenchmarkObservation {
  source: BenchmarkSource;
  raw_model_name: string;
  metric_key: BenchmarkMetricKey;
  score: number;
  release_tag: string;
}

export interface BenchmarkPollResult {
  source: BenchmarkSource;
  ok: boolean;
  observations: BenchmarkObservation[];
  release_tag?: string;
  error?: string;
  duration_ms: number;
}

export const BenchmarksConfigSchema = z.object({
  epoch: z.object({
    zip_url: z.string().url(),
    eci_filename_suffix: z.string(),
    calibration_min: z.number(),
    calibration_max: z.number(),
  }),
  livebench: z.object({
    github_contents_api: z.string().url(),
    base_url: z.string().url(),
    fallback_release: z.string(),
  }),
  bfcl: z.object({
    csv_url: z.string().url(),
  }),
  aider: z.object({
    yaml_url: z.string().url(),
  }),
  swebench: z.object({
    json_url: z.string().url(),
  }),
  scoring: z.object({
    shrinkage_lambda: z.number().min(0).max(5),
    prior_mean: z.number().min(0).max(100),
  }),
  weights: z.object({
    composite: z.object({
      eci: z.number(),
      livebench: z.number(),
      bfcl: z.number(),
    }),
    agentic_coding: z.object({
      swebench_verified: z.number(),
      aider_polyglot: z.number(),
      livebench_coding: z.number(),
      bfcl_overall: z.number(),
      livebench_reasoning: z.number(),
      context_headroom: z.number(),
    }),
  }),
});

export type BenchmarksConfig = z.infer<typeof BenchmarksConfigSchema>;

let cachedBenchmarksConfig: BenchmarksConfig | null = null;

/**
 * Loads and Zod-validates benchmark source URLs and scoring weights.
 */
export function getBenchmarksConfig(): BenchmarksConfig {
  if (!cachedBenchmarksConfig) {
    cachedBenchmarksConfig = BenchmarksConfigSchema.parse(benchmarksRaw);
  }
  return cachedBenchmarksConfig;
}
