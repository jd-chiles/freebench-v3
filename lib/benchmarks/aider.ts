import { fetchTextWithTimeout, formatErrorMessage } from '@/lib/providers/http';
import {
  getBenchmarksConfig,
  type BenchmarkObservation,
  type BenchmarkPollResult,
} from './types';

function stripYamlQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Zero-dependency YAML list parser for Aider's `polyglot_leaderboard.yml`.
 * Extracts model identifiers and `pass_rate_2` (0-100), retaining the highest score per model.
 */
export function parseAiderPolyglotYaml(
  yamlText: string,
  releaseTag: string = 'aider-polyglot'
): BenchmarkObservation[] {
  const lines = yamlText.split(/\r?\n/);
  const entries: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (trimmed.startsWith('- ')) {
      if (current) {
        entries.push(current);
      }
      current = {};
      const rest = trimmed.slice(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.slice(0, colonIdx).trim();
        const val = stripYamlQuotes(rest.slice(colonIdx + 1));
        current[key] = val;
      }
      continue;
    }

    if (current) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = stripYamlQuotes(trimmed.slice(colonIdx + 1));
        current[key] = val;
      }
    }
  }

  if (current) {
    entries.push(current);
  }

  const bestByModel = new Map<string, number>();

  for (const entry of entries) {
    const rawName = (entry.model || entry.dirname || '').trim();
    const rawRate = entry.pass_rate_2;
    if (!rawName || !rawRate) continue;

    const score = Number(rawRate.replace(/%/g, '').trim());
    if (!Number.isFinite(score) || score < 0 || score > 100) continue;

    const rounded = Math.round(score * 100) / 100;
    const prev = bestByModel.get(rawName);
    if (prev === undefined || rounded > prev) {
      bestByModel.set(rawName, rounded);
    }
  }

  return [...bestByModel.entries()].map(([rawModelName, score]) => ({
    source: 'aider',
    raw_model_name: rawModelName,
    metric_key: 'aider_polyglot',
    score,
    release_tag: releaseTag,
  }));
}

/**
 * Downloads and parses Aider Polyglot coding benchmark leaderboard YAML.
 */
export async function pollAiderPolyglot(): Promise<BenchmarkPollResult> {
  const startedAt = Date.now();
  const config = getBenchmarksConfig().aider;

  try {
    const yamlText = await fetchTextWithTimeout(config.yaml_url, {}, 20_000);
    const observations = parseAiderPolyglotYaml(yamlText, 'aider-polyglot-live');

    if (observations.length === 0) {
      throw new Error('Parsed 0 observations from Aider Polyglot YAML');
    }

    return {
      source: 'aider',
      ok: true,
      observations,
      release_tag: 'aider-polyglot-live',
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      source: 'aider',
      ok: false,
      observations: [],
      error: formatErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    };
  }
}
