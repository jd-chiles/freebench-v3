import { describe, expect, it } from 'vitest';
import {
  calibrateEci,
  computeAgenticCodingScore,
  computeCohortCompositeScores,
  computeCompositeScore,
} from '@/lib/scoring/composite';

describe('Composite & Agentic Coding Scoring', () => {
  it('calibrates ECI within [0, 100] and dynamically expands upper anchor', () => {
    expect(calibrateEci(80)).toBe(0);
    expect(calibrateEci(165)).toBe(100);
    expect(calibrateEci(200)).toBe(100);
    expect(calibrateEci(122.5)).toBe(50);

    // Cohort expansion prevents frontier saturation above 165
    expect(calibrateEci(180, { min: 80, max: 180 })).toBe(100);
    expect(calibrateEci(130, { min: 80, max: 180 })).toBe(50);
  });

  it('applies Bayesian shrinkage on partial coverage and zero shrinkage on 3/3', () => {
    const full = computeCompositeScore({ eci: 140, livebenchGlobal: 75, bfclOverall: 80 });
    expect(full.coverageCount).toBe(3);
    expect(full.freebenchScore).toBeGreaterThan(70);

    const partial = computeCompositeScore({ eci: null, livebenchGlobal: 60, bfclOverall: 80 });
    expect(partial.coverageCount).toBe(2);
    expect(partial.freebenchScore).toBeLessThan(68.33);

    const single = computeCompositeScore({ eci: null, livebenchGlobal: null, bfclOverall: 82 });
    expect(single.coverageCount).toBe(1);
    expect(single.freebenchScore).toBe(68.29);

    const empty = computeCompositeScore({ eci: null, livebenchGlobal: null, bfclOverall: null });
    expect(empty.coverageCount).toBe(0);
    expect(empty.freebenchScore).toBeNull();
  });

  it('prevents 1-pillar models from beating strong 3/3 frontier models in cohort scoring', () => {
    const scores = computeCohortCompositeScores([
      { eci: 145, livebenchGlobal: 78, bfclOverall: 81 }, // strong 3/3 frontier
      { eci: 120, livebenchGlobal: 55, bfclOverall: 65 },
      { eci: 105, livebenchGlobal: 42, bfclOverall: 50 },
      { eci: null, livebenchGlobal: null, bfclOverall: 88 }, // 1/3 BFCL-only outlier
    ]);

    expect(scores[0]?.coverageCount).toBe(3);
    expect(scores[3]?.coverageCount).toBe(1);
    expect(scores[0]!.freebenchScore!).toBeGreaterThan(scores[3]!.freebenchScore!);
  });

  it('requires tool calling and incorporates SWE-bench + Aider in agentic coding score', () => {
    const disallowed = computeAgenticCodingScore({
      swebenchVerified: 65,
      aiderPolyglot: 72,
      livebenchCoding: 75,
      bfclOverall: 80,
      livebenchReasoning: 70,
      contextWindow: 131072,
      supportsTools: false,
    });
    expect(disallowed).toBeNull();

    const valid = computeAgenticCodingScore({
      swebenchVerified: 60,
      aiderPolyglot: 70,
      livebenchCoding: 80,
      bfclOverall: 80,
      livebenchReasoning: 70,
      contextWindow: 200000,
      supportsTools: true,
    });
    // 60*0.30 + 70*0.25 + 80*0.20 + 80*0.15 + 70*0.05 + 100*0.05 = 72.0
    expect(valid).toBe(72);
  });
});
