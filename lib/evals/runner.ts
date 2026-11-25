import { formatErrorMessage } from '@/lib/providers/http';
import { getProvidersConfig } from '@/lib/providers/types';
import { endEvalGeneration, initLangfuseTracing, startEvalGeneration } from './langfuse';
import type { ProviderSlug } from '@/lib/supabase/types';
import {
  EVAL_PILLAR_WEIGHTS,
  FB_EVAL_SUITE_VERSION,
  type AnchorPoint,
  type CalibrationReport,
  type EvalMessage,
  type EvalPillar,
  type EvalPrompt,
  type EvalTurnCaller,
  type ModelEvalSummary,
  type PromptRunResult,
} from './types';

function averageRanks(values: readonly number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) {
      j += 1;
    }
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      ranks[indexed[k]!.i] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

/**
 * Computes Pearson linear correlation coefficient `r` across `(x, y)` pairs.
 */
export function computePearsonR(
  pairs: ReadonlyArray<{ x: number; y: number }>
): number | null {
  if (pairs.length < 2) return null;
  const n = pairs.length;
  const meanX = pairs.reduce((s, p) => s + p.x, 0) / n;
  const meanY = pairs.reduce((s, p) => s + p.y, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of pairs) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const denom = Math.sqrt(denX * denY);
  if (denom === 0) return null;
  return Math.round((num / denom) * 10_000) / 10_000;
}

/**
 * Computes Spearman rank correlation `rho` across `(x, y)` pairs with average-rank tie handling.
 */
export function computeSpearmanRho(
  pairs: ReadonlyArray<{ x: number; y: number }>
): number | null {
  if (pairs.length < 2) return null;
  const rx = averageRanks(pairs.map((p) => p.x));
  const ry = averageRanks(pairs.map((p) => p.y));
  return computePearsonR(rx.map((x, idx) => ({ x, y: ry[idx]! })));
}

/**
 * Summarizes anchor calibration results with Spearman `rho` and Pearson `r` vs. `freebench_score`.
 */
export function buildCalibrationReport(
  anchors: ReadonlyArray<{
    canonicalId: string;
    freebenchScore: number;
    evalSummary: ModelEvalSummary;
  }>
): CalibrationReport {
  const points: AnchorPoint[] = anchors.map((a) => ({
    canonicalId: a.canonicalId,
    freebenchScore: a.freebenchScore,
    evalScore: a.evalSummary.overallScore,
    pillarScores: a.evalSummary.pillarScores,
    passedCount: a.evalSummary.passedCount,
    totalCount: a.evalSummary.totalCount,
  }));

  const pairs = points.map((p) => ({ x: p.freebenchScore, y: p.evalScore }));
  return {
    suiteVersion: anchors[0]?.evalSummary.suiteVersion ?? FB_EVAL_SUITE_VERSION,
    seedTag: anchors[0]?.evalSummary.seedTag ?? '',
    anchorCount: points.length,
    spearmanRho: computeSpearmanRho(pairs),
    pearsonR: computePearsonR(pairs),
    anchors: points,
  };
}

interface ProviderCompletionCall {
  url: string;
  init: RequestInit;
  extractText: (json: unknown) => string;
}

function buildCompletionRequest(
  target: { provider_slug: ProviderSlug; provider_model_id: string },
  messages: ReadonlyArray<EvalMessage>,
  maxTokens: number,
  env: Record<string, string | undefined>
): ProviderCompletionCall {
  const cfg = getProvidersConfig()[target.provider_slug];
  const apiKey = env[cfg.env_var]?.trim() ?? '';

  if (target.provider_slug === 'google') {
    if (!apiKey) {
      throw new Error('Missing GOOGLE_AI_API_KEY');
    }
    const systemMsg = messages.find((m) => m.role === 'system');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const modelPath = encodeURIComponent(target.provider_model_id);
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
          contents,
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
        }),
      },
      extractText: (json) => {
        const data = json as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      },
    };
  }

  if (target.provider_slug === 'cloudflare') {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!accountId || !apiKey) {
      throw new Error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
    }
    return {
      url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        accountId
      )}/ai/run/${target.provider_model_id}`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: 0,
          max_tokens: maxTokens,
        }),
      },
      extractText: (json) => {
        const data = json as { result?: { response?: string } };
        return data.result?.response ?? '';
      },
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (target.provider_slug !== 'pollinations') {
    if (!apiKey) {
      throw new Error(`Missing ${cfg.env_var}`);
    }
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (target.provider_slug === 'openrouter') {
    headers['HTTP-Referer'] = 'https://freebench.org';
    headers['X-Title'] = 'FreeBench';
  }

  return {
    url: `${cfg.api_base_url.replace(/\/$/, '')}/chat/completions`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: target.provider_model_id,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: 0,
        max_tokens: maxTokens,
      }),
    },
    extractText: (json) => {
      const data = json as {
        choices?: Array<{
          message?: {
            content?: string | Array<{ text?: string }> | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
          };
        }>;
      };
      const msg = data.choices?.[0]?.message;
      const content = msg?.content;
      if (typeof content === 'string' && content.trim().length > 0) return content;
      if (Array.isArray(content)) {
        const joined = content.map((part) => part.text ?? '').join('');
        if (joined.trim().length > 0) return joined;
      }
      return msg?.reasoning_content ?? msg?.reasoning ?? '';
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers: Headers, bodyText: string = ''): number {
  const raw = headers.get('retry-after');
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(35_000, Math.max(1000, Math.round(secs * 1000) + 250));
    }
  }
  const bodyMatch = bodyText.match(/try again in\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/i);
  if (bodyMatch?.[1] && bodyMatch?.[2]) {
    const val = Number(bodyMatch[1]);
    if (Number.isFinite(val) && val > 0) {
      const ms = bodyMatch[2].toLowerCase() === 'ms' ? Math.round(val) : Math.round(val * 1000);
      return Math.min(35_000, Math.max(1000, ms + 300));
    }
  }
  return 2000;
}

/**
 * Invokes a free-tier LLM endpoint with a multi-turn message list at `temperature: 0`
 * and Retry-After backoff on HTTP 429/503.
 */
export async function callModelMessages(
  target: { provider_slug: ProviderSlug; provider_model_id: string },
  messages: ReadonlyArray<EvalMessage>,
  maxTokens: number,
  env: Record<string, string | undefined> = process.env,
  timeoutMs: number = 45_000,
  traceMetadata: Record<string, string | number> = {}
): Promise<{ text: string; latencyMs: number }> {
  const req = buildCompletionRequest(target, messages, maxTokens, env);
  initLangfuseTracing(env);
  const generation = startEvalGeneration({
    model: target.provider_model_id,
    messages,
    metadata: { providerSlug: target.provider_slug, ...traceMetadata },
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const res = await fetch(req.url, { ...req.init, signal: controller.signal });
      const latencyMs = Date.now() - startedAt;

      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const bodyText = await res.text().catch(() => '');
        const waitMs = parseRetryAfterMs(res.headers, bodyText);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const snippet = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ').trim();
        throw new Error(`HTTP ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ''}`);
      }

      const json = (await res.json()) as unknown;
      const text = req.extractText(json);
      const data = json as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      endEvalGeneration(generation, {
        output: text,
        inputTokens: data.usage?.prompt_tokens ?? data.usageMetadata?.promptTokenCount,
        outputTokens: data.usage?.completion_tokens ?? data.usageMetadata?.candidatesTokenCount,
      });
      return { text, latencyMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const status = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
      endEvalGeneration(generation, {
        error: status ? `Provider request failed (HTTP ${status})` : 'Provider request failed',
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  endEvalGeneration(generation, { error: 'Provider request retries exhausted' });
  throw new Error('Exhausted eval request retries');
}

/**
 * Invokes a free-tier LLM endpoint at `temperature: 0` with Retry-After backoff on HTTP 429/503.
 */
export async function callModelForEval(
  target: { provider_slug: ProviderSlug; provider_model_id: string },
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  env: Record<string, string | undefined> = process.env,
  timeoutMs: number = 45_000,
  traceMetadata: Record<string, string | number> = {}
): Promise<{ text: string; latencyMs: number }> {
  return callModelMessages(
    target,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens,
    env,
    timeoutMs,
    traceMetadata
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Runs the full 20-prompt FB-Eval v2 suite on a single model endpoint and returns
 * weighted pillar and overall `0-100` scores.
 */
export async function evaluateModel(
  target: {
    canonical_id: string;
    provider_slug: ProviderSlug;
    provider_model_id: string;
  },
  suite: ReadonlyArray<EvalPrompt>,
  options: {
    seedTag: string;
    delayMs?: number;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
  }
): Promise<ModelEvalSummary> {
  const baseDelay = options.delayMs ?? 400;
  const providerMinDelay =
    options.delayMs === 0
      ? 0
      : target.provider_slug === 'groq'
        ? 2500
        : target.provider_slug === 'mistral'
          ? 1200
          : 0;
  const delayMs = Math.max(baseDelay, providerMinDelay);
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const promptResults: PromptRunResult[] = [];
  const latencies: number[] = [];
  let consecutiveErrors = 0;
  let aborted = false;
  let abortReason: string | undefined;

  for (let i = 0; i < suite.length; i += 1) {
    const prompt = suite[i]!;
    if (i > 0 && delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      let graded;
      let latencyMs: number;
      if (prompt.runMultiTurn) {
        let turnIndex = 0;
        const callTurn: EvalTurnCaller = async (messages, maxTokens) => {
          if (turnIndex > 0 && delayMs > 0) {
            await sleep(delayMs);
          }
          const currentTurn = turnIndex + 1;
          turnIndex += 1;
          return callModelMessages(target, messages, maxTokens, env, timeoutMs, {
            canonicalId: target.canonical_id,
            suiteVersion: FB_EVAL_SUITE_VERSION,
            seedTag: options.seedTag,
            promptId: prompt.id,
            pillar: prompt.pillar,
            turn: currentTurn,
          });
        };
        const multiRes = await prompt.runMultiTurn(callTurn);
        graded = multiRes.grade;
        latencyMs = multiRes.totalLatencyMs;
      } else {
        const res = await callModelForEval(
          target,
          prompt.systemPrompt,
          prompt.userPrompt,
          prompt.maxTokens,
          env,
          timeoutMs,
          {
            canonicalId: target.canonical_id,
            suiteVersion: FB_EVAL_SUITE_VERSION,
            seedTag: options.seedTag,
            promptId: prompt.id,
            pillar: prompt.pillar,
          }
        );
        latencyMs = res.latencyMs;
        graded = await prompt.grade(res.text);
      }
      consecutiveErrors = 0;
      latencies.push(latencyMs);
      promptResults.push({
        promptId: prompt.id,
        pillar: prompt.pillar,
        passed: graded.passed,
        score: graded.score,
        latencyMs,
        detail: graded.detail,
      });
    } catch (error) {
      const errMsg = formatErrorMessage(error);
      const isModelToolUseError =
        /\bHTTP\s+400\b/i.test(errMsg) && /tool_use_failed/i.test(errMsg);
      if (isModelToolUseError) {
        promptResults.push({
          promptId: prompt.id,
          pillar: prompt.pillar,
          passed: false,
          score: 0,
          latencyMs: 0,
          detail: 'Model invoked native tool call instead of JSON',
          error: errMsg,
        });
        continue;
      }

      consecutiveErrors += 1;
      promptResults.push({
        promptId: prompt.id,
        pillar: prompt.pillar,
        passed: false,
        score: 0,
        latencyMs: 0,
        detail: 'Provider request failed',
        error: errMsg,
      });

      const isFatalHttp = /\bHTTP\s+(401|402|403|404)\b/i.test(errMsg);
      if (isFatalHttp || consecutiveErrors >= 2) {
        aborted = true;
        abortReason = errMsg;
        break;
      }
    }
  }

  const pillars: EvalPillar[] = ['coding', 'tools', 'if', 'reasoning'];
  const pillarScores = {} as Record<EvalPillar, number>;
  for (const pillar of pillars) {
    const items = promptResults.filter((r) => r.pillar === pillar);
    const mean = items.length > 0 ? items.reduce((s, r) => s + r.score, 0) / items.length : 0;
    pillarScores[pillar] = round2(mean * 100);
  }

  const overallScore = round2(
    pillars.reduce((acc, p) => acc + pillarScores[p] * EVAL_PILLAR_WEIGHTS[p], 0)
  );
  const passedCount = promptResults.filter((r) => r.passed).length;
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
      : null;

  return {
    canonicalId: target.canonical_id,
    providerSlug: target.provider_slug,
    providerModelId: target.provider_model_id,
    suiteVersion: FB_EVAL_SUITE_VERSION,
    seedTag: options.seedTag,
    overallScore,
    pillarScores,
    passedCount,
    totalCount: suite.length,
    avgLatencyMs,
    promptResults,
    evaluatedAt: new Date().toISOString(),
    aborted,
    abortReason,
  };
}
