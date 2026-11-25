import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computePearsonR,
  computeSpearmanRho,
  evaluateModel,
} from '@/lib/evals/runner';
import { runSandboxedJsTests } from '@/lib/evals/sandbox';
import { buildEvalSuite } from '@/lib/evals/suite';

describe('FB-Eval v1 Micro-Benchmark Suite, Sandbox & Correlation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes 20/20 reference solutions and rejects empty/malformed answers', async () => {
    const suite = buildEvalSuite('2026-11');
    expect(suite).toHaveLength(20);
    expect(suite.filter((p) => p.pillar === 'coding')).toHaveLength(6);
    expect(suite.filter((p) => p.pillar === 'tools')).toHaveLength(5);
    expect(suite.filter((p) => p.pillar === 'if')).toHaveLength(4);
    expect(suite.filter((p) => p.pillar === 'reasoning')).toHaveLength(5);

    for (const prompt of suite) {
      const okRes = await prompt.grade(prompt.referenceAnswer);
      expect(okRes.passed, `Reference failed for ${prompt.id}: ${okRes.detail}`).toBe(true);
      expect(okRes.score).toBe(1);

      const badRes = await prompt.grade('');
      expect(badRes.passed, `Empty output unexpectedly passed ${prompt.id}`).toBe(false);
    }
  });

  it('produces distinct parameterized prompts and answers across monthly seed tags', () => {
    const nov = buildEvalSuite('2026-11');
    const dec = buildEvalSuite('2026-12');

    const diffCount = nov.filter(
      (p, idx) =>
        p.userPrompt !== dec[idx]?.userPrompt || p.referenceAnswer !== dec[idx]?.referenceAnswer
    ).length;
    expect(diffCount).toBeGreaterThanOrEqual(8);
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

  it('evaluates models across OpenAI-compatible and Google Gemini response formats', async () => {
    const suite = buildEvalSuite('2026-11').slice(0, 4);
    const answers = new Map(suite.map((p) => [p.userPrompt, p.referenceAnswer]));

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ role: string; content: string }>;
          contents?: Array<{ parts?: Array<{ text?: string }> }>;
        };
        const userText =
          body.messages?.find((m) => m.role === 'user')?.content ??
          body.contents?.[0]?.parts?.[0]?.text ??
          '';
        const reply = answers.get(userText) ?? '';

        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: reply } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );

    const groqSummary = await evaluateModel(
      { canonical_id: 'test-model', provider_slug: 'groq', provider_model_id: 'llama-3.3-70b-versatile' },
      suite,
      { seedTag: '2026-11', delayMs: 0, env: { GROQ_API_KEY: 'test-key' } }
    );
    expect(groqSummary.passedCount).toBe(4);
    expect(groqSummary.pillarScores.coding).toBe(100);

    const googleSummary = await evaluateModel(
      { canonical_id: 'gemini-2.5-flash', provider_slug: 'google', provider_model_id: 'gemini-2.5-flash' },
      suite,
      { seedTag: '2026-11', delayMs: 0, env: { GOOGLE_AI_API_KEY: 'test-key' } }
    );
    expect(googleSummary.passedCount).toBe(4);
  });
});
