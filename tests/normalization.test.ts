import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeModelId, sanitizeModelIdentifier } from '@/lib/normalization/normalize';

describe('Model Normalization & Aliasing', () => {
  it('resolves exact aliases across providers and benchmarks', () => {
    const res1 = normalizeModelId('deepseek/deepseek-r1-0528:free');
    expect(res1.matched).toBe(true);
    expect(res1.canonicalId).toBe('deepseek-r1-0528');

    const resBase = normalizeModelId('deepseek/deepseek-r1:free');
    expect(resBase.matched).toBe(true);
    expect(resBase.canonicalId).toBe('deepseek-r1');

    const res2 = normalizeModelId('DeepSeek-R1');
    expect(res2.matched).toBe(true);
    expect(res2.canonicalId).toBe('deepseek-r1');
  });

  it('keeps distinct model variants separated and strips benchmark suffixes', () => {
    expect(normalizeModelId('@cf/google/gemma-3-12b-it').canonicalId).toBe('gemma-3-12b-it');
    expect(normalizeModelId('deepseek-r1-distill-qwen-32b').canonicalId).toBe(
      'deepseek-r1-distill-qwen-32b'
    );
    expect(normalizeModelId('zai/glm-4.5-air').canonicalId).toBe('glm-4.5-air');
    expect(normalizeModelId('GLM-4.5-Flash').canonicalId).toBe('glm-4.5-flash');
    expect(normalizeModelId('Qwen3-235B-A22B (FC)').canonicalId).toBe('qwen3-235b-a22b');
    expect(sanitizeModelIdentifier('nvidia/llama-3.1-nemotron-ultra-253b-v1-free')).toBe(
      'llama-3.1-nemotron-ultra-253b-v1'
    );
  });

  it('has zero duplicate sanitized aliases in config/aliases.json', () => {
    const raw = JSON.parse(
      readFileSync(resolve(process.cwd(), 'config/aliases.json'), 'utf8')
    ) as Record<string, { aliases: string[] }>;
    const seen = new Map<string, string>();
    const entries = Object.entries(raw);
    expect(entries.length).toBeGreaterThan(20);
    for (const [canonicalId, entry] of entries) {
      const canonicalKey = sanitizeModelIdentifier(canonicalId);
      const existingCanonical = seen.get(canonicalKey);
      expect(existingCanonical, `Duplicate canonical key ${canonicalKey}`).toBeUndefined();
      seen.set(canonicalKey, canonicalId);
      for (const alias of entry.aliases) {
        const key = sanitizeModelIdentifier(alias);
        const owner = seen.get(key);
        expect(
          owner === undefined || owner === canonicalId,
          `Alias collision for "${alias}" (${key}): ${owner} vs ${canonicalId}`
        ).toBe(true);
        seen.set(key, canonicalId);
      }
    }
  });

  it('sanitizes provider prefixes and quantization suffixes', () => {
    expect(sanitizeModelIdentifier('@cf/meta/llama-3.3-70b-instruct-fp8-fast')).toBe(
      'llama-3.3-70b-instruct'
    );

    const res = normalizeModelId('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(res.matched).toBe(true);
    expect(res.canonicalId).toBe('llama-3.3-70b-instruct');
  });

  it('falls back cleanly for unknown models and flags matched=false', () => {
    const res = normalizeModelId('acme/super-coder-14b:free');
    expect(res.matched).toBe(false);
    expect(res.canonicalId).toBe('acme-super-coder-14b');
  });
});
