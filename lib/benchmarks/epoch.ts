import { parse } from 'csv-parse/sync';
import { strFromU8, unzipSync } from 'fflate';
import { formatErrorMessage } from '@/lib/providers/http';
import {
  getBenchmarksConfig,
  type BenchmarkObservation,
  type BenchmarkPollResult,
} from './types';

function pickColumnKey(headers: string[], candidates: string[]): string | null {
  const lowerMap = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));
  for (const candidate of candidates) {
    const hit = lowerMap.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Parses Epoch AI's `eci_scores.csv` contents into normalized ECI score observations.
 */
export function parseEpochEciCsv(
  csvText: string,
  releaseTag: string = 'epoch-eci'
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
    pickColumnKey(headers, [
      'model',
      'model_name',
      'model_version',
      'display_name',
      'name',
      'id',
    ]) ?? headers[0];

  const scoreCol = pickColumnKey(headers, [
    'eci',
    'eci_score',
    'score',
    'mean',
    'value',
    'index',
  ]);

  if (!modelCol || !scoreCol) {
    throw new Error(`Unable to locate model/ECI columns in CSV headers: ${headers.join(', ')}`);
  }

  const observations: BenchmarkObservation[] = [];
  for (const row of rows) {
    const rawName = row[modelCol]?.trim();
    const rawScore = row[scoreCol]?.trim();
    if (!rawName || !rawScore) continue;

    const numericScore = Number(rawScore);
    if (!Number.isFinite(numericScore)) continue;

    observations.push({
      source: 'epoch',
      raw_model_name: rawName,
      metric_key: 'eci_score',
      score: Math.round(numericScore * 100) / 100,
      release_tag: releaseTag,
    });
  }

  return observations;
}

/**
 * Extracts and parses `eci_scores.csv` from a zipped Epoch AI benchmark bundle.
 */
export function parseEpochZipBuffer(
  zipBytes: Uint8Array,
  eciFilenameSuffix: string = 'eci_scores.csv'
): { observations: BenchmarkObservation[]; matchedFile: string } {
  const files = unzipSync(zipBytes);
  const matchingPath = Object.keys(files).find((filePath) =>
    filePath.toLowerCase().endsWith(eciFilenameSuffix.toLowerCase())
  );

  if (!matchingPath) {
    throw new Error(`Could not find *${eciFilenameSuffix} inside Epoch AI zip archive`);
  }

  const entryBytes = files[matchingPath];
  if (!entryBytes) {
    throw new Error(`Empty zip entry for ${matchingPath}`);
  }

  const csvText = strFromU8(entryBytes);
  const observations = parseEpochEciCsv(csvText, 'epoch-latest');
  return { observations, matchedFile: matchingPath };
}

/**
 * Downloads Epoch AI `benchmark_data.zip` and extracts ECI capability scores.
 */
export async function pollEpochBenchmarks(): Promise<BenchmarkPollResult> {
  const startedAt = Date.now();
  const config = getBenchmarksConfig().epoch;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(config.zip_url, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const { observations, matchedFile } = parseEpochZipBuffer(
      new Uint8Array(arrayBuffer),
      config.eci_filename_suffix
    );

    return {
      source: 'epoch',
      ok: true,
      observations,
      release_tag: matchedFile,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Epoch ZIP download timed out after 30000ms'
        : formatErrorMessage(error);
    return {
      source: 'epoch',
      ok: false,
      observations: [],
      error: message,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
