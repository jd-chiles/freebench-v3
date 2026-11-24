import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import {
  fetchJsonWithTimeout,
  fetchTextWithTimeout,
  formatErrorMessage,
} from '@/lib/providers/http';
import {
  getBenchmarksConfig,
  type BenchmarkMetricKey,
  type BenchmarkObservation,
  type BenchmarkPollResult,
} from './types';

const GitHubContentItemSchema = z.object({
  name: z.string(),
});

const CategoriesJsonSchema = z.record(z.string(), z.array(z.string()));

function mapCategoryToMetricKey(categoryName: string): BenchmarkMetricKey | null {
  const lower = categoryName.toLowerCase().trim();
  if (lower.includes('coding')) return 'livebench_coding';
  if (lower.includes('reasoning')) return 'livebench_reasoning';
  if (lower.includes('math')) return 'livebench_math';
  if (lower === 'if' || lower.includes('instruction')) return 'livebench_if';
  if (lower.includes('data')) return 'livebench_data';
  return null;
}

/**
 * Parses LiveBench `table_<date>.csv` and `categories_<date>.json` into per-category
 * averages and a `livebench_global` mean across available categories.
 */
export function parseLiveBenchData(
  csvText: string,
  categoriesMap: Record<string, string[]>,
  releaseTag: string
): BenchmarkObservation[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, string>>;

  if (rows.length === 0) return [];
  const firstRow = rows[0];
  if (!firstRow) return [];

  const headers = Object.keys(firstRow);
  const modelCol =
    headers.find((h) => h.toLowerCase().trim() === 'model') ??
    headers.find((h) => h.toLowerCase().includes('model')) ??
    headers[0];

  if (!modelCol) {
    throw new Error('LiveBench CSV missing model column');
  }

  const observations: BenchmarkObservation[] = [];

  for (const row of rows) {
    const rawModel = row[modelCol]?.trim();
    if (!rawModel) continue;

    const categoryMeans: number[] = [];

    for (const [categoryName, taskColumns] of Object.entries(categoriesMap)) {
      const taskScores: number[] = [];
      for (const taskCol of taskColumns) {
        const cell = row[taskCol]?.trim();
        if (!cell) continue;
        const parsed = Number(cell);
        if (Number.isFinite(parsed)) {
          taskScores.push(parsed);
        }
      }

      if (taskScores.length === 0) continue;
      const categoryMean =
        Math.round((taskScores.reduce((sum, n) => sum + n, 0) / taskScores.length) * 100) / 100;
      categoryMeans.push(categoryMean);

      const metricKey = mapCategoryToMetricKey(categoryName);
      if (metricKey) {
        observations.push({
          source: 'livebench',
          raw_model_name: rawModel,
          metric_key: metricKey,
          score: categoryMean,
          release_tag: releaseTag,
        });
      }
    }

    if (categoryMeans.length > 0) {
      const globalMean =
        Math.round(
          (categoryMeans.reduce((sum, n) => sum + n, 0) / categoryMeans.length) * 100
        ) / 100;

      observations.push({
        source: 'livebench',
        raw_model_name: rawModel,
        metric_key: 'livebench_global',
        score: globalMean,
        release_tag: releaseTag,
      });
    }
  }

  return observations;
}

async function discoverLatestLiveBenchRelease(
  githubApiUrl: string,
  fallbackRelease: string
): Promise<string> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'FreeBench/0.0.1',
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const raw = await fetchJsonWithTimeout<unknown>(githubApiUrl, { headers }, 10_000);
    const items = z.array(GitHubContentItemSchema).parse(raw);

    const dates: string[] = [];
    for (const item of items) {
      const match = /^table_(\d{4}_\d{2}_\d{2})\.csv$/i.exec(item.name);
      if (match?.[1]) {
        dates.push(match[1]);
      }
    }

    dates.sort((a, b) => b.localeCompare(a));
    return dates[0] ?? fallbackRelease;
  } catch {
    return fallbackRelease;
  }
}

/**
 * Discovers and ingests the newest LiveBench release CSV + category mapping JSON.
 */
export async function pollLiveBench(): Promise<BenchmarkPollResult> {
  const startedAt = Date.now();
  const config = getBenchmarksConfig().livebench;

  try {
    const release = await discoverLatestLiveBenchRelease(
      config.github_contents_api,
      config.fallback_release
    );

    const tableUrl = `${config.base_url}/table_${release}.csv`;
    const categoriesUrl = `${config.base_url}/categories_${release}.json`;

    const [csvText, rawCategories] = await Promise.all([
      fetchTextWithTimeout(tableUrl, {}, 20_000),
      fetchJsonWithTimeout<unknown>(categoriesUrl, {}, 15_000),
    ]);

    const categoriesMap = CategoriesJsonSchema.parse(rawCategories);
    const observations = parseLiveBenchData(csvText, categoriesMap, release);

    return {
      source: 'livebench',
      ok: true,
      observations,
      release_tag: release,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      source: 'livebench',
      ok: false,
      observations: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
