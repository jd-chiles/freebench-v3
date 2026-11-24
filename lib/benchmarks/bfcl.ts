import { parse } from 'csv-parse/sync';
import { fetchTextWithTimeout, formatErrorMessage } from '@/lib/providers/http';
import {
  getBenchmarksConfig,
  type BenchmarkObservation,
  type BenchmarkPollResult,
} from './types';

function parsePercentNumber(rawValue: string | undefined): number | null {
  if (!rawValue) return null;
  const cleaned = rawValue.replace(/%/g, '').trim();
  if (!cleaned || cleaned === 'N/A' || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

/**
 * Parses BFCL's `data_overall.csv` into `bfcl_overall` observations.
 */
export function parseBfclCsv(
  csvText: string,
  releaseTag: string = 'bfcl-latest'
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
    headers.find((h) => h.toLowerCase().includes('model'));
  const overallCol =
    headers.find((h) => h.toLowerCase().trim() === 'overall acc') ??
    headers.find((h) => h.toLowerCase().includes('overall'));

  if (!modelCol || !overallCol) {
    throw new Error(`Unable to locate Model/Overall Acc columns in BFCL CSV: ${headers.join(', ')}`);
  }

  const observations: BenchmarkObservation[] = [];
  for (const row of rows) {
    const rawModel = row[modelCol]?.trim();
    if (!rawModel) continue;

    const score = parsePercentNumber(row[overallCol]);
    if (score === null) continue;

    observations.push({
      source: 'bfcl',
      raw_model_name: rawModel,
      metric_key: 'bfcl_overall',
      score,
      release_tag: releaseTag,
    });
  }

  return observations;
}

/**
 * Downloads and parses Berkeley Function Calling Leaderboard (BFCL) `data_overall.csv`.
 */
export async function pollBfcl(): Promise<BenchmarkPollResult> {
  const startedAt = Date.now();
  const config = getBenchmarksConfig().bfcl;

  try {
    const csvText = await fetchTextWithTimeout(config.csv_url, {}, 20_000);
    const observations = parseBfclCsv(csvText, 'bfcl-live');

    return {
      source: 'bfcl',
      ok: true,
      observations,
      release_tag: 'bfcl-live',
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      source: 'bfcl',
      ok: false,
      observations: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
