import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseAiderPolyglotYaml } from '@/lib/benchmarks/aider';
import { parseBfclCsv } from '@/lib/benchmarks/bfcl';
import { parseEpochZipBuffer } from '@/lib/benchmarks/epoch';
import { parseLiveBenchData } from '@/lib/benchmarks/livebench';
import { parseSweBenchJson } from '@/lib/benchmarks/swebench';

describe('Benchmark Parsers', () => {
  it('extracts and parses eci_scores.csv from Epoch ZIP buffer', () => {
    const csvContent = 'model,eci_score\nDeepSeek-R1,141.2\nGemini 2.5 Pro,144.0\n';
    const zipBytes = zipSync({
      'epoch_capabilities_index/eci_scores.csv': strToU8(csvContent),
    });

    const { observations, matchedFile } = parseEpochZipBuffer(zipBytes);
    expect(matchedFile).toBe('epoch_capabilities_index/eci_scores.csv');
    expect(observations).toEqual([
      {
        source: 'epoch',
        raw_model_name: 'DeepSeek-R1',
        metric_key: 'eci_score',
        score: 141.2,
        release_tag: 'epoch-latest',
      },
      {
        source: 'epoch',
        raw_model_name: 'Gemini 2.5 Pro',
        metric_key: 'eci_score',
        score: 144,
        release_tag: 'epoch-latest',
      },
    ]);
  });

  it('computes LiveBench category averages and global mean', () => {
    const csv = 'model,code_gen,code_debug,logic,math_comp\ndeepseek-r1,80,70,90,82\n';
    const categories = {
      coding: ['code_gen', 'code_debug'],
      reasoning: ['logic'],
      math: ['math_comp'],
    };

    const observations = parseLiveBenchData(csv, categories, '2026_06_25');
    const byKey = new Map(observations.map((o) => [o.metric_key, o.score]));

    expect(byKey.get('livebench_coding')).toBe(75);
    expect(byKey.get('livebench_reasoning')).toBe(90);
    expect(byKey.get('livebench_math')).toBe(82);
    expect(byKey.get('livebench_global')).toBe(82.33);
  });

  it('parses BFCL data_overall.csv and strips percentage signs', () => {
    const csv = 'Rank,Model,Overall Acc\n1,Kimi-K2-Instruct,83.20%\n2,Broken,N/A\n';
    const observations = parseBfclCsv(csv, 'bfcl-test');

    expect(observations).toEqual([
      {
        source: 'bfcl',
        raw_model_name: 'Kimi-K2-Instruct',
        metric_key: 'bfcl_overall',
        score: 83.2,
        release_tag: 'bfcl-test',
      },
    ]);
  });

  it('parses Aider Polyglot YAML and keeps highest pass_rate_2 per model', () => {
    const yaml = `
- dirname: 2025-05-deepseek-r1
  model: deepseek/deepseek-r1
  pass_rate_1: 54.0
  pass_rate_2: 71.4
- dirname: 2025-01-deepseek-r1-old
  model: deepseek/deepseek-r1
  pass_rate_2: 56.9
- dirname: broken
  model: empty-model
  pass_rate_2: N/A
`;
    const observations = parseAiderPolyglotYaml(yaml, 'aider-test');
    expect(observations).toEqual([
      {
        source: 'aider',
        raw_model_name: 'deepseek/deepseek-r1',
        metric_key: 'aider_polyglot',
        score: 71.4,
        release_tag: 'aider-test',
      },
    ]);
  });

  it('parses SWE-bench Verified leaderboard JSON safely', () => {
    const raw = {
      leaderboards: [
        {
          name: 'Lite',
          results: [{ name: 'Ignore Lite', resolved: 10.5 }],
        },
        {
          name: 'Verified',
          results: [
            { name: 'Gemini 2.5 Pro', resolved: 63.8 },
            { model: 'DeepSeek-V3', percent_resolved: '49.2%' },
          ],
        },
      ],
    };

    const observations = parseSweBenchJson(raw, 'swe-test');
    expect(observations).toEqual([
      {
        source: 'swebench',
        raw_model_name: 'Gemini 2.5 Pro',
        metric_key: 'swebench_verified',
        score: 63.8,
        release_tag: 'swe-test',
      },
      {
        source: 'swebench',
        raw_model_name: 'DeepSeek-V3',
        metric_key: 'swebench_verified',
        score: 49.2,
        release_tag: 'swe-test',
      },
    ]);
  });
});
