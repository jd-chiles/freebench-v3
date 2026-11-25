import type { ProviderSlug } from '@/lib/supabase/types';

export type EvalPillar = 'coding' | 'tools' | 'if' | 'reasoning';

export const FB_EVAL_SUITE_VERSION = 'v2';

export const EVAL_PILLAR_WEIGHTS: Record<EvalPillar, number> = {
  coding: 0.35,
  tools: 0.2,
  if: 0.15,
  reasoning: 0.3,
};

export interface EvalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type EvalTurnCaller = (
  messages: ReadonlyArray<EvalMessage>,
  maxTokens: number
) => Promise<{ text: string; latencyMs: number }>;

export interface EvalGradeResult {
  passed: boolean;
  /** Normalized score in [0, 1]. */
  score: number;
  detail: string;
}

export interface EvalPrompt {
  id: string;
  pillar: EvalPillar;
  title: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  referenceAnswer: string;
  grade: (output: string) => Promise<EvalGradeResult> | EvalGradeResult;
  runMultiTurn?: (
    callTurn: EvalTurnCaller
  ) => Promise<{ grade: EvalGradeResult; totalLatencyMs: number }>;
  referenceTurns?: ReadonlyArray<string>;
}

export interface PromptRunResult {
  promptId: string;
  pillar: EvalPillar;
  passed: boolean;
  score: number;
  latencyMs: number;
  detail: string;
  error?: string;
}

export interface ModelEvalSummary {
  canonicalId: string;
  providerSlug: ProviderSlug;
  providerModelId: string;
  suiteVersion: string;
  seedTag: string;
  overallScore: number;
  pillarScores: Record<EvalPillar, number>;
  passedCount: number;
  totalCount: number;
  avgLatencyMs: number | null;
  promptResults: PromptRunResult[];
  evaluatedAt: string;
  aborted?: boolean;
  abortReason?: string;
}

export interface AnchorPoint {
  canonicalId: string;
  freebenchScore: number;
  evalScore: number;
  pillarScores: Record<EvalPillar, number>;
  passedCount: number;
  totalCount: number;
}

export interface CalibrationReport {
  suiteVersion: string;
  seedTag: string;
  anchorCount: number;
  spearmanRho: number | null;
  pearsonR: number | null;
  anchors: AnchorPoint[];
}
