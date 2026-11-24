import { getBenchmarksConfig } from '@/lib/benchmarks/types';

export interface CompositeScoreInput {
  eci: number | null | undefined;
  livebenchGlobal: number | null | undefined;
  bfclOverall: number | null | undefined;
}

export interface PillarStats {
  mean: number;
  std: number;
}

export interface CompositeScoreOptions {
  pillarStats?: Partial<Record<'eci' | 'livebench' | 'bfcl', PillarStats>>;
  cohortEciRange?: { min: number; max: number };
  priorMean?: number;
  shrinkageLambda?: number;
}

export interface CompositeScoreOutput {
  freebenchScore: number | null;
  coverageCount: 0 | 1 | 2 | 3;
}

export interface AgenticCodingInput {
  swebenchVerified?: number | null | undefined;
  aiderPolyglot?: number | null | undefined;
  livebenchCoding: number | null | undefined;
  bfclOverall: number | null | undefined;
  livebenchReasoning: number | null | undefined;
  contextWindow: number | null | undefined;
  supportsTools: boolean | null | undefined;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function isValidFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function computeStats(values: number[]): PillarStats | undefined {
  if (values.length < 3) return undefined;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std <= 0.01) return undefined;
  return { mean, std };
}

function standardizeOrClamp(value: number, stats?: PillarStats): number {
  if (stats && Number.isFinite(stats.std) && stats.std > 0.01) {
    return clampScore(50 + 15 * ((value - stats.mean) / stats.std));
  }
  return clampScore(value);
}

/**
 * Linearly maps Epoch Capabilities Index (ECI) onto a 0-100 scale, expanding bounds
 * dynamically when frontier cohort scores exceed static anchors.
 */
export function calibrateEci(
  rawEci: number,
  cohortRange?: { min: number; max: number }
): number {
  const { calibration_min, calibration_max } = getBenchmarksConfig().epoch;
  const effectiveMin = cohortRange
    ? Math.min(calibration_min, cohortRange.min)
    : calibration_min;
  const effectiveMax = cohortRange
    ? Math.max(calibration_max, cohortRange.max)
    : calibration_max;

  if (effectiveMax <= effectiveMin) {
    return clampScore(rawEci);
  }
  const normalized = ((rawEci - effectiveMin) / (effectiveMax - effectiveMin)) * 100;
  return roundTwo(clampScore(normalized));
}

/**
 * Computes the weighted FreeBench Composite Score (0-100) across Epoch ECI (40%),
 * LiveBench Global (35%), and BFCL Overall (25%), with optional cross-pillar z-score
 * standardization and Bayesian shrinkage toward the prior mean for partial coverage.
 */
export function computeCompositeScore(
  input: CompositeScoreInput,
  options?: CompositeScoreOptions
): CompositeScoreOutput {
  const config = getBenchmarksConfig();
  const rawWeights = config.weights.composite;
  const weightTotal = rawWeights.eci + rawWeights.livebench + rawWeights.bfcl;
  const normWeights =
    weightTotal > 0
      ? {
          eci: rawWeights.eci / weightTotal,
          livebench: rawWeights.livebench / weightTotal,
          bfcl: rawWeights.bfcl / weightTotal,
        }
      : { eci: 0.4, livebench: 0.35, bfcl: 0.25 };

  const pillars: Array<{ value: number; weight: number }> = [];

  if (isValidFinite(input.eci)) {
    const calibrated = calibrateEci(input.eci, options?.cohortEciRange);
    pillars.push({
      value: standardizeOrClamp(calibrated, options?.pillarStats?.eci),
      weight: normWeights.eci,
    });
  }
  if (isValidFinite(input.livebenchGlobal)) {
    pillars.push({
      value: standardizeOrClamp(clampScore(input.livebenchGlobal), options?.pillarStats?.livebench),
      weight: normWeights.livebench,
    });
  }
  if (isValidFinite(input.bfclOverall)) {
    pillars.push({
      value: standardizeOrClamp(clampScore(input.bfclOverall), options?.pillarStats?.bfcl),
      weight: normWeights.bfcl,
    });
  }

  const coverageCount = pillars.length as 0 | 1 | 2 | 3;
  if (coverageCount === 0) {
    return { freebenchScore: null, coverageCount: 0 };
  }

  const totalWeight = pillars.reduce((sum, p) => sum + p.weight, 0);
  const weightedSum = pillars.reduce((sum, p) => sum + p.value * p.weight, 0);
  const missingWeight = Math.max(0, 1 - totalWeight);
  const lambda = options?.shrinkageLambda ?? config.scoring.shrinkage_lambda;
  const priorMean = options?.priorMean ?? config.scoring.prior_mean;

  const shrunkScore =
    (weightedSum + lambda * missingWeight * priorMean) /
    (totalWeight + lambda * missingWeight);

  return {
    freebenchScore: roundTwo(shrunkScore),
    coverageCount,
  };
}

/**
 * Computes cohort-normalized composite scores across all models using dynamic ECI scaling,
 * cross-pillar z-score standardization (when n >= 3 per pillar), and Bayesian shrinkage.
 */
export function computeCohortCompositeScores<T extends CompositeScoreInput>(
  items: T[]
): CompositeScoreOutput[] {
  const eciValues = items.map((item) => item.eci).filter(isValidFinite);
  const cohortEciRange =
    eciValues.length > 0
      ? { min: Math.min(...eciValues), max: Math.max(...eciValues) }
      : undefined;

  const calibratedEcis = eciValues.map((val) => calibrateEci(val, cohortEciRange));
  const livebenchValues = items
    .map((item) => item.livebenchGlobal)
    .filter(isValidFinite)
    .map(clampScore);
  const bfclValues = items
    .map((item) => item.bfclOverall)
    .filter(isValidFinite)
    .map(clampScore);

  const pillarStats: CompositeScoreOptions['pillarStats'] = {
    eci: computeStats(calibratedEcis),
    livebench: computeStats(livebenchValues),
    bfcl: computeStats(bfclValues),
  };

  return items.map((item) =>
    computeCompositeScore(item, {
      pillarStats,
      cohortEciRange,
    })
  );
}

/**
 * Maps context window length to a 0-100 headroom sub-score for multi-turn coding agents.
 */
export function scoreContextHeadroom(contextWindow: number | null | undefined): number | null {
  if (!isValidFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  if (contextWindow >= 200_000) return 100;
  if (contextWindow >= 128_000) return 90;
  if (contextWindow >= 64_000) return 75;
  if (contextWindow >= 32_000) return 55;
  return 35;
}

/**
 * Computes the Agentic Coding Score (0-100) tailored for autonomous coding loops
 * (OpenCode, Kilo Code, Hermes Agent, Freebuff, Cline, Aider). Returns null if tools
 * are unsupported or no coding/tool-calling benchmarks exist.
 */
export function computeAgenticCodingScore(input: AgenticCodingInput): number | null {
  if (input.supportsTools === false) {
    return null;
  }

  const hasCoreSignal =
    isValidFinite(input.swebenchVerified) ||
    isValidFinite(input.aiderPolyglot) ||
    isValidFinite(input.livebenchCoding) ||
    isValidFinite(input.bfclOverall);

  if (!hasCoreSignal) {
    return null;
  }

  const config = getBenchmarksConfig();
  const weights = config.weights.agentic_coding;
  const pillars: Array<{ value: number; weight: number }> = [];

  if (isValidFinite(input.swebenchVerified)) {
    pillars.push({ value: clampScore(input.swebenchVerified), weight: weights.swebench_verified });
  }
  if (isValidFinite(input.aiderPolyglot)) {
    pillars.push({ value: clampScore(input.aiderPolyglot), weight: weights.aider_polyglot });
  }
  if (isValidFinite(input.livebenchCoding)) {
    pillars.push({ value: clampScore(input.livebenchCoding), weight: weights.livebench_coding });
  }
  if (isValidFinite(input.bfclOverall)) {
    pillars.push({ value: clampScore(input.bfclOverall), weight: weights.bfcl_overall });
  }
  if (isValidFinite(input.livebenchReasoning)) {
    pillars.push({
      value: clampScore(input.livebenchReasoning),
      weight: weights.livebench_reasoning,
    });
  }

  const contextSubscore = scoreContextHeadroom(input.contextWindow);
  if (contextSubscore !== null) {
    pillars.push({ value: contextSubscore, weight: weights.context_headroom });
  }

  const totalWeight = pillars.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return null;

  const weightedSum = pillars.reduce((sum, p) => sum + p.value * p.weight, 0);
  if (totalWeight < 0.5) {
    const missingWeight = Math.max(0, 1 - totalWeight);
    const priorMean = config.scoring.prior_mean;
    return roundTwo((weightedSum + 0.15 * missingWeight * priorMean) / (totalWeight + 0.15 * missingWeight));
  }

  return roundTwo(weightedSum / totalWeight);
}
