import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computePearsonR,
  computeSpearmanRho,
  evaluateModel,
} from '@/lib/evals/runner';
import { runSandboxedJsTests } from '@/lib/evals/sandbox';
import { buildEvalSuite } from '@/lib/evals/suite';

describe('FB-Eval v2 Frontier Suite, Multi-Turn, Sandbox & Correlation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes 20/20 reference solutions across multiple monthly seeds and rejects empty answers', async () => {
    for (const seed of ['2026-11', '2026-12', '2027-01']) {
      const suite = buildEvalSuite(seed);
      expect(suite).toHaveLength(20);
      expect(suite.filter((p) => p.pillar === 'coding')).toHaveLength(6);
      expect(suite.filter((p) => p.pillar === 'tools')).toHaveLength(4);
      expect(suite.filter((p) => p.pillar === 'if')).toHaveLength(4);
      expect(suite.filter((p) => p.pillar === 'reasoning')).toHaveLength(6);

      for (const prompt of suite) {
        if (prompt.runMultiTurn && prompt.referenceTurns) {
          let turnIdx = 0;
          const turns = prompt.referenceTurns;
          const okMulti = await prompt.runMultiTurn(async () => {
            const text = turns[turnIdx] ?? '';
            turnIdx += 1;
            return { text, latencyMs: 1 };
          });
          expect(
            okMulti.grade.passed,
            `Multi-turn ref failed for ${prompt.id} (${seed}): ${okMulti.grade.detail}`
          ).toBe(true);
          expect(okMulti.grade.score).toBe(1);

          const badMulti = await prompt.runMultiTurn(async () => ({ text: '', latencyMs: 1 }));
          expect(badMulti.grade.passed, `Empty multi-turn passed ${prompt.id}`).toBe(false);
        } else {
          const okRes = await prompt.grade(prompt.referenceAnswer);
          expect(
            okRes.passed,
            `Reference failed for ${prompt.id} (${seed}): ${okRes.detail}`
          ).toBe(true);
          expect(okRes.score).toBe(1);

          const badRes = await prompt.grade('');
          expect(badRes.passed, `Empty output unexpectedly passed ${prompt.id}`).toBe(false);
        }
      }
    }
  });

  it('produces distinct parameterized prompts and answers across monthly seed tags', () => {
    const nov = buildEvalSuite('2026-11');
    const dec = buildEvalSuite('2026-12');

    const diffCount = nov.filter(
      (p, idx) =>
        p.userPrompt !== dec[idx]?.userPrompt || p.referenceAnswer !== dec[idx]?.referenceAnswer
    ).length;
    expect(diffCount).toBeGreaterThanOrEqual(14);
  });

  it('isolates host globals and enforces timeout in the JS VM sandbox', async () => {
    const timeoutRes = await runSandboxedJsTests('while (true) {}', '__record(true);', 40);
    expect(timeoutRes.passed).toBe(false);
    expect(timeoutRes.error).toBeTruthy();

    const escapeRes = await runSandboxedJsTests(
      'function leak() { return typeof process + ":" + typeof require; }',
      '__record(leak() === "undefined:undefined");',
      200
    );
    expect(escapeRes.passed).toBe(true);

    const suite = buildEvalSuite('2026-11');
    const exprPrompt = suite.find((p) => p.id === 'code-v2-expr-lang')!;
    const partialTimeout = await exprPrompt.grade(
      'function evalProgram(s) { if (s.includes("let x =")) while (true) {} return s === "-2^2" ? -4 : 512; }'
    );
    expect(partialTimeout.passed).toBe(false);
    expect(partialTimeout.score).toBeLessThan(1);
  });

  it('computes Spearman rank correlation and Pearson r accurately including ties', () => {
    expect(
      computeSpearmanRho([
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ])
    ).toBe(1);

    expect(
      computeSpearmanRho([
        { x: 10, y: 60 },
        { x: 30, y: 40 },
        { x: 50, y: 20 },
      ])
    ).toBe(-1);

    expect(
      computePearsonR([
        { x: 2, y: 4 },
        { x: 4, y: 8 },
        { x: 6, y: 12 },
      ])
    ).toBe(1);
  });

  it('evaluates single-turn and 3-turn prompts across OpenAI and Gemini formats (including model role mapping)', async () => {
    const full = buildEvalSuite('2026-11');
    const codePrompt = full.find((p) => p.id === 'code-v2-cron-next')!;
    const multiPrompt = full.find((p) => p.id === 'tools-v2-multiturn-pagination')!;
    const subset = [codePrompt, multiPrompt];

    let sawGeminiModelRole = false;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ role: string; content: string }>;
          contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
        };

        let reply = '';
        if (url.includes('generativelanguage.googleapis.com')) {
          const contents = body.contents ?? [];
          if (contents.some((c) => c.role === 'model')) {
            sawGeminiModelRole = true;
          }
          if (contents.length === 1) {
            const text = contents[0]?.parts?.[0]?.text ?? '';
            reply =
              text === codePrompt.userPrompt
                ? codePrompt.referenceAnswer
                : (multiPrompt.referenceTurns?.[0] ?? '');
          } else {
            const turnIdx = Math.floor((contents.length - 1) / 2);
            reply = multiPrompt.referenceTurns?.[turnIdx] ?? '';
          }
          return new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const msgs = body.messages ?? [];
        const userOnly = msgs.filter((m) => m.role === 'user');
        if (userOnly.length === 1 && userOnly[0]?.content === codePrompt.userPrompt) {
          reply = codePrompt.referenceAnswer;
        } else {
          const turnIdx = userOnly.length - 1;
          reply = multiPrompt.referenceTurns?.[turnIdx] ?? '';
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: reply } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );

    const groqSummary = await evaluateModel(
      { canonical_id: 'test-model', provider_slug: 'groq', provider_model_id: 'openai/gpt-oss-120b' },
      subset,
      { seedTag: '2026-11', delayMs: 0, env: { GROQ_API_KEY: 'test-key' } }
    );
    expect(groqSummary.passedCount).toBe(2);
    expect(groqSummary.pillarScores.coding).toBe(100);
    expect(groqSummary.pillarScores.tools).toBe(100);

    const googleSummary = await evaluateModel(
      { canonical_id: 'gemini-2.5-flash', provider_slug: 'google', provider_model_id: 'gemini-2.5-flash' },
      subset,
      { seedTag: '2026-11', delayMs: 0, env: { GOOGLE_AI_API_KEY: 'test-key' } }
    );
    expect(googleSummary.passedCount).toBe(2);
    expect(sawGeminiModelRole).toBe(true);
  });
});
