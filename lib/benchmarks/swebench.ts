import { fetchJsonWithTimeout, formatErrorMessage } from '@/lib/providers/http';
import {
  getBenchmarksConfig,
  type BenchmarkObservation,
  type BenchmarkPollResult,
} from './types';

interface SweBenchResultEntry {
  name?: unknown;
  model?: unknown;
  resolved?: unknown;
  percent_resolved?: unknown;
}

interface SweBenchLeaderboardSection {
  name?: unknown;
  results?: unknown;
}

function extractResultsArray(raw: unknown): SweBenchResultEntry[] {
  if (Array.isArray(raw)) {
    return raw as SweBenchResultEntry[];
  }
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.leaderboards)) {
    const boards = record.leaderboards as SweBenchLeaderboardSection[];
    const verified =
      boards.find(
        (b) => typeof b.name === 'string' && b.name.toLowerCase().trim() === 'verified'
      ) ??
      boards.find(
        (b) => typeof b.name === 'string' && b.name.toLowerCase().includes('verified')
      );
    if (verified && Array.isArray(verified.results)) {
      return verified.results as SweBenchResultEntry[];
    }
  }

  if (Array.isArray(record.results)) {
    return record.results as SweBenchResultEntry[];
  }

  return [];
}

/**
 * Parses SWE-bench Verified leaderboard JSON into `swebench_verified` observations.
 */
export function parseSweBenchJson(
  raw: unknown,
  releaseTag: string = 'swebench-verified'
): BenchmarkObservation[] {
  const results = extractResultsArray(raw);
  const bestByModel = new Map<string, number>();

  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue;
    const rawName =
      typeof entry.name === 'string'
        ? entry.name.trim()
        : typeof entry.model === 'string'
          ? entry.model.trim()
          : '';
    if (!rawName) continue;

    const rawScore = entry.resolved ?? entry.percent_resolved;
    const parsedScore =
      typeof rawScore === 'number'
        ? rawScore
        : typeof rawScore === 'string'
          ? Number(rawScore.replace(/%/g, '').trim())
          : Number.NaN;

    if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100) continue;
    const rounded = Math.round(parsedScore * 100) / 100;
    const prev = bestByModel.get(rawName);
    if (prev === undefined || rounded > prev) {
      bestByModel.set(rawName, rounded);
    }
  }

  return [...bestByModel.entries()].map(([rawModelName, score]) => ({
    source: 'swebench',
    raw_model_name: rawModelName,
    metric_key: 'swebench_verified',
    score,
    release_tag: releaseTag,
  }));
}

/**
 * Downloads and parses SWE-bench Verified leaderboard results.
 */
export async function pollSweBenchVerified(): Promise<BenchmarkPollResult> {
  const startedAt = Date.now();
  const config = getBenchmarksConfig().swebench;

  try {
    const rawJson = await fetchJsonWithTimeout<unknown>(config.json_url, {}, 20_000);
    const observations = parseSweBenchJson(rawJson, 'swebench-verified-live');

    if (observations.length === 0) {
      throw new Error('Parsed 0 observations from SWE-bench Verified JSON');
    }

    return {
      source: 'swebench',
      ok: true,
      observations,
      release_tag: 'swebench-verified-live',
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      source: 'swebench',
      ok: false,
      observations: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
