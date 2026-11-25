import { z } from 'zod';
import {
  extractCodeBlock,
  extractJsonPayload,
  runSandboxedJsTests,
  stripThinkingTags,
} from './sandbox';
import type { EvalPrompt } from './types';

/**
 * Returns the monthly anti-contamination seed tag (`YYYY-MM`).
 */
export function getCurrentSeedTag(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Creates a deterministic Mulberry32 PRNG seeded from an arbitrary string.
 */
export function createSeededRng(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function makeCodePrompt(
  id: string,
  title: string,
  userPrompt: string,
  referenceAnswer: string,
  harnessCode: string
): EvalPrompt {
  return {
    id,
    pillar: 'coding',
    title,
    systemPrompt:
      'You are an expert JavaScript engineer. Output only valid standalone JavaScript code (no imports, no tests, no prose).',
    userPrompt,
    maxTokens: 1536,
    referenceAnswer,
    grade: async (output) => {
      const code = extractCodeBlock(output);
      if (!code) {
        return { passed: false, score: 0, detail: 'Empty code output' };
      }
      const res = await runSandboxedJsTests(code, harnessCode, 1000);
      const score = res.totalTests > 0 ? res.passedTests / res.totalTests : 0;
      const detail = res.error
        ? `${res.passedTests}/${res.totalTests} tests (${res.error})`
        : `${res.passedTests}/${res.totalTests} tests`;
      return { passed: res.passed, score: Math.round(score * 100) / 100, detail };
    },
  };
}

/**
 * Generates the deterministic 20-prompt FB-Eval v1 suite parameterized by `seedTag` (`YYYY-MM`).
 */
export function buildEvalSuite(seedTag: string = getCurrentSeedTag()): EvalPrompt[] {
  const rng = createSeededRng(`fb-eval-v1:${seedTag}`);

  const lruCap = randInt(rng, 2, 3);
  const k1 = pick(rng, ['alpha', 'node', 'cache']);
  const k2 = pick(rng, ['beta', 'edge', 'route']);
  const k3 = pick(rng, ['gamma', 'core', 'mesh']);

  const offset = randInt(rng, 2, 7);

  const city = pick(rng, ['Tokyo', 'Berlin', 'Austin', 'Toronto']);
  const currency = pick(rng, ['EUR', 'JPY', 'GBP', 'CAD']);
  const minCtx = pick(rng, [65536, 131072, 262144]);
  const providerA = pick(rng, ['groq', 'openrouter', 'mistral']);
  const providerB = providerA === 'groq' ? 'cloudflare' : 'groq';
  const fallbackModel = pick(rng, ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'gpt-oss-120b']);

  const ifTopic = pick(rng, ['caching', 'routing', 'indexing', 'telemetry']);
  const forbiddenWord = pick(rng, ['however', 'basically', 'simply', 'obviously']);
  const jsonStatus = pick(rng, ['healthy', 'degraded', 'ready']);
  const jsonScore = randInt(rng, 62, 94);

  const svcName = pick(rng, ['auth-edge', 'billing-api', 'queue-worker']);
  const errCode = pick(rng, ['ERR_POOL_EXHAUSTED', 'ERR_TOKEN_DRIFT', 'ERR_TLS_HANDSHAKE']);
  const ownerName = pick(rng, ['Maya Lin', 'Devon Brooks', 'Priya Patel']);

  // Seeded reasoning numbers
  const startBal = randInt(rng, 120, 220);
  const dep1 = randInt(rng, 40, 80);
  const wd1 = randInt(rng, 25, 55);
  const feePct = pick(rng, [10, 20]);
  const dep2 = randInt(rng, 30, 60);
  const step1 = startBal + dep1 - wd1;
  const afterFee = Math.round(step1 * (1 - feePct / 100));
  const finalBalance = afterFee + dep2;

  const wAB = randInt(rng, 2, 5);
  const wAC = randInt(rng, 6, 10);
  const wBD = randInt(rng, 3, 6);
  const wCD = randInt(rng, 1, 3);
  const wDF = randInt(rng, 2, 5);
  const wAF = wAB + wBD + wDF + 4;
  const shortestPath = Math.min(wAB + wBD + wDF, wAC + wCD + wDF, wAF);

  const rateA = randInt(rng, 4, 8);
  const rateB = randInt(rng, 3, 6);
  const leadMins = randInt(rng, 5, 10);
  const workTarget = rateA * leadMins + (rateA + rateB) * randInt(rng, 4, 8);
  const totalMins = leadMins + (workTarget - rateA * leadMins) / (rateA + rateB);

  const codename = `ORION-${randInt(rng, 100, 999)}`;
  const vaultCode = `VAULT-${randInt(rng, 4000, 9999)}`;

  const fillerLine = (idx: number) =>
    `[${idx}] heartbeat ok region=us-east latency=${12 + (idx % 17)}ms status=200 worker=pool-${idx % 7} digest=${(idx * 97) % 1000}`;
  const needleParagraphs: string[] = [];
  for (let i = 1; i <= 110; i += 1) {
    if (i === 28) {
      needleParagraphs.push(
        `[28] SECURITY_NOTICE: Project transfer assigned to codename=${codename} under primary escalation track.`
      );
    } else if (i === 86) {
      needleParagraphs.push(
        `[86] RECOVERY_KEY_MAP: For codename=${codename}, the active sealed vault_code=${vaultCode}.`
      );
    } else {
      needleParagraphs.push(fillerLine(i));
    }
  }
  const haystackText = needleParagraphs.join('\n');

  const prompts: EvalPrompt[] = [
    // ======================== 1. CODING (6) ========================
    makeCodePrompt(
      'code-lru-cache',
      'LRU Cache Implementation',
      `Write a JavaScript class \`LRUCache\` with constructor \`constructor(capacity)\`, \`get(key)\` (returns \`-1\` if missing, marks recently used), and \`put(key, value)\` (evicts least-recently-used key when exceeding capacity).`,
      `class LRUCache {
  constructor(capacity) {
    this.cap = capacity;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return -1;
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }
  put(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
}`,
      `
        const c = new LRUCache(${lruCap});
        c.put('${k1}', 1);
        c.put('${k2}', 2);
        __record(c.get('${k1}') === 1);
        c.put('${k3}', 3);
        ${
          lruCap === 2
            ? `__record(c.get('${k2}') === -1); __record(c.get('${k1}') === 1);`
            : `__record(c.get('${k2}') === 2); c.put('extra', 4); __record(c.get('${k3}') === -1 || c.get('${k1}') === -1);`
        }
        c.put('${k3}', 99);
        __record(c.get('${k3}') === 99);
        __record(c.get('missing') === -1);
      `
    ),

    makeCodePrompt(
      'code-interval-merge',
      'Merge Overlapping Intervals',
      `Write a JavaScript function \`mergeIntervals(intervals)\` that takes an array of \`[start, end]\` pairs (possibly unsorted, empty, or touching like \`[1,3],[3,5]\`) and returns sorted non-overlapping merged intervals without mutating the input array.`,
      `function mergeIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  const sorted = intervals.map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], cur[1]);
    } else {
      out.push(cur);
    }
  }
  return out;
}`,
      `
        __record(__deepEqual(mergeIntervals([]), []));
        __record(__deepEqual(mergeIntervals([[8, 10], [1, 3], [2, 6]]), [[1, 6], [8, 10]]));
        __record(__deepEqual(mergeIntervals([[1, ${offset}], [${offset}, ${offset + 4}]]), [[1, ${offset + 4}]]));
        __record(__deepEqual(mergeIntervals([[1, 10], [2, 3], [4, 5]]), [[1, 10]]));
      `
    ),

    makeCodePrompt(
      'code-async-limit',
      'Bounded Async Concurrency Pool',
      `Write an async JavaScript function \`runWithConcurrency(tasks, limit)\` where \`tasks\` is an array of zero-arg functions returning Promises. Run at most \`limit\` tasks concurrently, preserve output order, and reject if any task rejects.`,
      `async function runWithConcurrency(tasks, limit) {
  if (tasks.length === 0) return [];
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next;
      next += 1;
      results[idx] = await tasks[idx]();
    }
  }
  const count = Math.min(Math.max(1, limit), tasks.length);
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}`,
      `
        __record(__deepEqual(await runWithConcurrency([], 2), []));
        let active = 0;
        let peak = 0;
        const tasks = [10, 20, 30, 40, 50].map((v, idx) => async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, idx % 2 === 0 ? 10 : 5));
          active -= 1;
          return v + ${offset};
        });
        const out = await runWithConcurrency(tasks, 2);
        __record(__deepEqual(out, [${10 + offset}, ${20 + offset}, ${30 + offset}, ${40 + offset}, ${50 + offset}]));
        __record(peak <= 2);
        let rejected = false;
        try {
          await runWithConcurrency([async () => 1, async () => { throw new Error('boom'); }], 2);
        } catch {
          rejected = true;
        }
        __record(rejected === true);
      `
    ),

    makeCodePrompt(
      'code-semver-sort',
      'Semver Comparator',
      `Write a JavaScript function \`sortSemver(versions)\` that returns a new array sorted ascending by numeric \`major.minor.patch\`, with pre-release versions like \`1.2.0-alpha\` coming before \`1.2.0\`.`,
      `function sortSemver(versions) {
  function parse(v) {
    const [core, pre = ''] = v.split('-');
    const [maj, min, pat] = core.split('.').map(Number);
    return { maj, min, pat, pre };
  }
  return [...versions].sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (pa.maj !== pb.maj) return pa.maj - pb.maj;
    if (pa.min !== pb.min) return pa.min - pb.min;
    if (pa.pat !== pb.pat) return pa.pat - pb.pat;
    if (!pa.pre && pb.pre) return 1;
    if (pa.pre && !pb.pre) return -1;
    return pa.pre.localeCompare(pb.pre);
  });
}`,
      `
        __record(__deepEqual(sortSemver(['1.10.0', '1.2.0', '1.2.0-beta', '0.9.1']), ['0.9.1', '1.2.0-beta', '1.2.0', '1.10.0']));
        __record(__deepEqual(sortSemver(['2.0.0', '10.0.0', '2.0.1']), ['2.0.0', '2.0.1', '10.0.0']));
        __record(__deepEqual(sortSemver([]), []));
      `
    ),

    makeCodePrompt(
      'code-bugfix-query-parser',
      'Query String Parser Bugfix',
      `Write a JavaScript function \`parseQueryString(qs)\` that parses a URL query string (with or without leading \`?\`), decodes \`+\` as space and \`%XX\` escapes, treats keys without \`=\` as \`""\`, and aggregates repeated keys into an array of strings.`,
      `function parseQueryString(qs) {
  const clean = qs.startsWith('?') ? qs.slice(1) : qs;
  const out = {};
  if (!clean) return out;
  for (const part of clean.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? '' : part.slice(eq + 1);
    const key = decodeURIComponent(rawKey.replace(/\\+/g, ' '));
    const val = decodeURIComponent(rawVal.replace(/\\+/g, ' '));
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = Array.isArray(out[key]) ? [...out[key], val] : [out[key], val];
    } else {
      out[key] = val;
    }
  }
  return out;
}`,
      `
        __record(__deepEqual(parseQueryString(''), {}));
        __record(__deepEqual(parseQueryString('?q=hello+world&flag&tag=a&tag=b'), { q: 'hello world', flag: '', tag: ['a', 'b'] }));
        __record(__deepEqual(parseQueryString('k=1%262&k=3'), { k: ['1&2', '3'] }));
      `
    ),

    makeCodePrompt(
      'code-arithmetic-eval',
      'RPN Evaluator',
      `Write a JavaScript function \`evalRpn(tokens)\` that evaluates an array of Reverse Polish Notation tokens (\`+\`, \`-\`, \`*\`, \`/\` with integer division truncating toward zero) and returns the final number.`,
      `function evalRpn(tokens) {
  const stack = [];
  for (const tok of tokens) {
    if (tok === '+' || tok === '-' || tok === '*' || tok === '/') {
      const b = stack.pop();
      const a = stack.pop();
      if (tok === '+') stack.push(a + b);
      else if (tok === '-') stack.push(a - b);
      else if (tok === '*') stack.push(a * b);
      else stack.push(Math.trunc(a / b));
    } else {
      stack.push(Number(tok));
    }
  }
  return stack[0];
}`,
      `
        __record(evalRpn(['2', '1', '+', '${offset}', '*']) === ${3 * offset});
        __record(evalRpn(['4', '13', '5', '/', '+']) === 6);
        __record(evalRpn(['-7', '2', '/']) === -3);
      `
    ),

    // ======================== 2. TOOL CALLING & JSON (5) ========================
    {
      id: 'tools-single-select',
      pillar: 'tools',
      title: 'Single Tool Argument Extraction',
      systemPrompt: 'Output ONLY valid JSON matching the requested schema. No markdown fences or prose.',
      userPrompt: `Available tools:
1. search_models(provider: string, min_context: number, zero_training: boolean)
2. ping_endpoint(url: string)

User request: "Find models on ${providerA} with at least ${minCtx} context tokens that do not train on my data."
Return JSON: {"tool": "<name>", "arguments": { ... }}`,
      maxTokens: 1024,
      referenceAnswer: JSON.stringify({
        tool: 'search_models',
        arguments: { provider: providerA, min_context: minCtx, zero_training: true },
      }),
      grade: (output) => {
        const schema = z.object({
          tool: z.literal('search_models'),
          arguments: z.object({
            provider: z.string(),
            min_context: z.number(),
            zero_training: z.literal(true),
          }),
        });
        try {
          const parsed = schema.parse(JSON.parse(extractJsonPayload(output)));
          const ok =
            parsed.arguments.provider.toLowerCase() === providerA &&
            parsed.arguments.min_context === minCtx;
          return { passed: ok, score: ok ? 1 : 0, detail: ok ? 'Exact tool + args' : 'Arg mismatch' };
        } catch (err) {
          return {
            passed: false,
            score: 0,
            detail: err instanceof Error ? err.message.slice(0, 80) : 'Invalid JSON',
          };
        }
      },
    },

    {
      id: 'tools-parallel-plan',
      pillar: 'tools',
      title: 'Parallel Multi-Tool Call',
      systemPrompt: 'Output ONLY a JSON array of tool calls. No prose.',
      userPrompt: `Available tools:
- fetch_weather(city: string)
- get_fx_rate(currency: string)

User request: "Check the weather in ${city} and the USD exchange rate for ${currency} in parallel."
Return JSON array: [{"tool":"...", "arguments":{...}}, ...]`,
      maxTokens: 1024,
      referenceAnswer: JSON.stringify([
        { tool: 'fetch_weather', arguments: { city } },
        { tool: 'get_fx_rate', arguments: { currency } },
      ]),
      grade: (output) => {
        const schema = z.array(
          z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()) })
        );
        try {
          const calls = schema.parse(JSON.parse(extractJsonPayload(output)));
          const hasWeather = calls.some(
            (c) =>
              c.tool === 'fetch_weather' &&
              String(c.arguments.city ?? '').toLowerCase() === city.toLowerCase()
          );
          const hasFx = calls.some(
            (c) =>
              c.tool === 'get_fx_rate' &&
              String(c.arguments.currency ?? '').toUpperCase() === currency
          );
          const ok = hasWeather && hasFx && calls.length === 2;
          return { passed: ok, score: ok ? 1 : 0, detail: ok ? '2/2 parallel calls' : 'Missing call' };
        } catch {
          return { passed: false, score: 0, detail: 'Invalid tool array JSON' };
        }
      },
    },

    {
      id: 'tools-abstain',
      pillar: 'tools',
      title: 'Tool Abstention Guard',
      systemPrompt: 'Output ONLY valid JSON. Never invent a tool that does not exist.',
      userPrompt: `Available tools:
- get_stock_price(ticker: string)
- convert_units(value: number, from: string, to: string)

User request: "Explain the difference between TCP and UDP in one sentence."
Since no tool applies, return {"tool": null, "reason": "<brief reason>"}.`,
      maxTokens: 1024,
      referenceAnswer: JSON.stringify({
        tool: null,
        reason: 'Conceptual networking question does not require external tools.',
      }),
      grade: (output) => {
        const schema = z.object({
          tool: z.null(),
          reason: z.string().min(4),
        });
        try {
          schema.parse(JSON.parse(extractJsonPayload(output)));
          return { passed: true, score: 1, detail: 'Abstained cleanly' };
        } catch {
          return { passed: false, score: 0, detail: 'Hallucinated tool or invalid schema' };
        }
      },
    },

    {
      id: 'tools-error-recovery',
      pillar: 'tools',
      title: '429 Fallback Tool Recovery',
      systemPrompt: 'Output ONLY valid JSON.',
      userPrompt: `Available tool: call_llm(provider: string, model_id: string)
Previous step result: call_llm(provider="${providerA}", model_id="${fallbackModel}") failed with HTTP 429 Rate Limit Exceeded.
Fallback rule: Switch to provider="${providerB}" using the exact same model_id.
Return {"tool": "call_llm", "arguments": {"provider": "...", "model_id": "..."}}.`,
      maxTokens: 1024,
      referenceAnswer: JSON.stringify({
        tool: 'call_llm',
        arguments: { provider: providerB, model_id: fallbackModel },
      }),
      grade: (output) => {
        const schema = z.object({
          tool: z.literal('call_llm'),
          arguments: z.object({ provider: z.string(), model_id: z.string() }),
        });
        try {
          const parsed = schema.parse(JSON.parse(extractJsonPayload(output)));
          const ok =
            parsed.arguments.provider.toLowerCase() === providerB &&
            parsed.arguments.model_id === fallbackModel;
          return { passed: ok, score: ok ? 1 : 0, detail: ok ? 'Recovered to fallback' : 'Wrong target' };
        } catch {
          return { passed: false, score: 0, detail: 'Invalid recovery JSON' };
        }
      },
    },

    {
      id: 'tools-nested-schema',
      pillar: 'tools',
      title: 'Strict Nested Routing Schema',
      systemPrompt: 'Output ONLY valid JSON matching the exact schema.',
      userPrompt: `Return JSON with keys:
- "service": "${svcName}"
- "env": "production"
- "retries": integer 2
- "targets": array of 2 objects with {"region": string, "weight": integer}, where weights sum to 100 and regions are "iad1" and "fra1".`,
      maxTokens: 1024,
      referenceAnswer: JSON.stringify({
        service: svcName,
        env: 'production',
        retries: 2,
        targets: [
          { region: 'iad1', weight: 60 },
          { region: 'fra1', weight: 40 },
        ],
      }),
      grade: (output) => {
        const schema = z.object({
          service: z.literal(svcName),
          env: z.literal('production'),
          retries: z.literal(2),
          targets: z
            .array(z.object({ region: z.string(), weight: z.number().int().positive() }))
            .length(2),
        });
        try {
          const parsed = schema.parse(JSON.parse(extractJsonPayload(output)));
          const sum = parsed.targets[0]!.weight + parsed.targets[1]!.weight;
          const regions = new Set(parsed.targets.map((t) => t.region));
          const ok = sum === 100 && regions.has('iad1') && regions.has('fra1');
          return { passed: ok, score: ok ? 1 : 0, detail: ok ? 'Valid nested schema' : 'Sum/region mismatch' };
        } catch {
          return { passed: false, score: 0, detail: 'Schema validation failed' };
        }
      },
    },

    // ======================== 3. VERIFIABLE CONSTRAINTS / IFEVAL (4) ========================
    {
      id: 'if-exact-structure',
      pillar: 'if',
      title: 'Multi-Constraint Bullet Formatting',
      systemPrompt: 'Follow every formatting constraint strictly.',
      userPrompt: `Write tips about API ${ifTopic} obeying ALL 4 rules:
1. Output EXACTLY 3 lines, each starting with "- ".
2. Total word count across all 3 lines must be between 18 and 42 words.
3. Include the exact word "${ifTopic}" (case-insensitive).
4. Do NOT use the word "${forbiddenWord}" anywhere.`,
      maxTokens: 1024,
      referenceAnswer: `- Measure API ${ifTopic} overhead before tuning timeouts across production edge nodes.\n- Keep ${ifTopic} payloads compact so retries stay fast under bursty load.\n- Audit logs weekly to spot silent ${ifTopic} regressions early.`,
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const lines = clean
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const words = clean.split(/\s+/).filter(Boolean);
        const c1 = lines.length === 3 && lines.every((l) => l.startsWith('- '));
        const c2 = words.length >= 18 && words.length <= 42;
        const c3 = clean.toLowerCase().includes(ifTopic.toLowerCase());
        const c4 = !new RegExp(`\\b${forbiddenWord}\\b`, 'i').test(clean);
        const passedCount = [c1, c2, c3, c4].filter(Boolean).length;
        return {
          passed: passedCount === 4,
          score: passedCount / 4,
          detail: `${passedCount}/4 constraints (lines=${lines.length}, words=${words.length})`,
        };
      },
    },

    {
      id: 'if-strict-json-keys',
      pillar: 'if',
      title: 'Raw Unfenced Exact-Key JSON',
      systemPrompt: 'Output raw JSON only. Never wrap in markdown code blocks.',
      userPrompt: `Output a raw JSON object (no markdown \`\`\` fences, no extra keys) with:
- "status": "${jsonStatus}"
- "score": ${jsonScore}
- "tags": an array of exactly 3 lowercase strings.`,
      maxTokens: 1024,
      referenceAnswer: JSON.stringify({
        status: jsonStatus,
        score: jsonScore,
        tags: ['free', 'fast', 'verified'],
      }),
      grade: (output) => {
        const trimmed = stripThinkingTags(output);
        const unfenced = !trimmed.includes('```') && trimmed.startsWith('{') && trimmed.endsWith('}');
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          const keys = Object.keys(parsed).sort();
          const validKeys = keys.join(',') === 'score,status,tags';
          const validVals =
            parsed.status === jsonStatus &&
            parsed.score === jsonScore &&
            Array.isArray(parsed.tags) &&
            parsed.tags.length === 3 &&
            parsed.tags.every((t) => typeof t === 'string' && t === t.toLowerCase() && t.length > 0);
          const ok = unfenced && validKeys && validVals;
          return { passed: ok, score: ok ? 1 : 0, detail: ok ? 'Exact raw JSON' : 'Constraint failed' };
        } catch {
          return { passed: false, score: 0, detail: 'Invalid raw JSON' };
        }
      },
    },

    {
      id: 'if-grounded-extraction',
      pillar: 'if',
      title: 'Grounded Anti-Hallucination Extraction',
      systemPrompt: 'Extract only facts explicitly stated in the text. Output JSON only.',
      userPrompt: `Incident log: "Service ${svcName} triggered ${errCode} during peak traffic. Incident commander ${ownerName} rolled back release v4.2."
Return JSON with keys {"service", "error_code", "owner", "mitigation_eta"}. If a field is not stated in the log, set its value to "NOT_STATED".`,
      maxTokens: 1024,
      referenceAnswer: JSON.stringify({
        service: svcName,
        error_code: errCode,
        owner: ownerName,
        mitigation_eta: 'NOT_STATED',
      }),
      grade: (output) => {
        const schema = z.object({
          service: z.literal(svcName),
          error_code: z.literal(errCode),
          owner: z.literal(ownerName),
          mitigation_eta: z.literal('NOT_STATED'),
        });
        try {
          schema.parse(JSON.parse(extractJsonPayload(output)));
          return { passed: true, score: 1, detail: 'Grounded 4/4' };
        } catch {
          return { passed: false, score: 0, detail: 'Hallucinated or missed field' };
        }
      },
    },

    {
      id: 'if-format-transform',
      pillar: 'if',
      title: 'Filter & Sort CSV to Markdown Table',
      systemPrompt: 'Output ONLY the Markdown table with header and separator.',
      userPrompt: `Filter these CSV rows to status=active, sort descending by score, and output ONLY a Markdown table with columns | model | score |:
model,status,score
m-low,active,${60 + offset}
m-off,paused,99
m-top,active,${85 + offset}
m-mid,active,${72 + offset}`,
      maxTokens: 1024,
      referenceAnswer: `| model | score |\n| --- | --- |\n| m-top | ${85 + offset} |\n| m-mid | ${72 + offset} |\n| m-low | ${60 + offset} |`,
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const lines = clean
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('|'));
        const noPaused = !clean.includes('m-off');
        const idxTop = clean.indexOf('m-top');
        const idxMid = clean.indexOf('m-mid');
        const idxLow = clean.indexOf('m-low');
        const ordered = idxTop !== -1 && idxMid > idxTop && idxLow > idxMid;
        const ok = lines.length === 5 && noPaused && ordered;
        return { passed: ok, score: ok ? 1 : 0, detail: ok ? 'Sorted & filtered' : 'Table mismatch' };
      },
    },

    // ======================== 4. PARAMETERIZED REASONING & CONTEXT (5) ========================
    {
      id: 'reason-state-machine',
      pillar: 'reasoning',
      title: 'Multi-Step State Tracking',
      systemPrompt: 'Solve carefully. End your response with `FINAL: <integer>`.',
      userPrompt: `An account starts with $${startBal}.
1. Deposit $${dep1}.
2. Withdraw $${wd1}.
3. Apply a ${feePct}% maintenance fee to the current balance (round to nearest integer).
4. Deposit $${dep2}.
What is the final integer balance? End with \`FINAL: <integer>\`.`,
      maxTokens: 1536,
      referenceAnswer: `FINAL: ${finalBalance}`,
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const match = clean.match(/FINAL:\s*(-?\d+)/i) ?? clean.match(/(-?\d+)\s*$/);
        const got = match?.[1] ? Number(match[1]) : NaN;
        const ok = got === finalBalance;
        return { passed: ok, score: ok ? 1 : 0, detail: `got=${got}, expected=${finalBalance}` };
      },
    },

    {
      id: 'reason-graph-shortest',
      pillar: 'reasoning',
      title: 'Weighted DAG Shortest Path',
      systemPrompt: 'Compute the exact minimum total weight. End with `ANSWER: <integer>`.',
      userPrompt: `Find the minimum-cost path from node A to node F in this directed weighted graph:
- A -> B (${wAB})
- A -> C (${wAC})
- B -> D (${wBD})
- C -> D (${wCD})
- D -> F (${wDF})
- A -> F (${wAF})
End your response with \`ANSWER: <integer>\`.`,
      maxTokens: 1536,
      referenceAnswer: `ANSWER: ${shortestPath}`,
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const match = clean.match(/ANSWER:\s*(-?\d+)/i) ?? clean.match(/(-?\d+)\s*$/);
        const got = match?.[1] ? Number(match[1]) : NaN;
        const ok = got === shortestPath;
        return { passed: ok, score: ok ? 1 : 0, detail: `got=${got}, expected=${shortestPath}` };
      },
    },

    {
      id: 'reason-logic-grid',
      pillar: 'reasoning',
      title: '4-Entity Constraint Logic Grid',
      systemPrompt: 'Solve the logic puzzle and output ONLY JSON mapping each person to their language.',
      userPrompt: `Four engineers (Alice, Bob, Cara, Dan) each use a distinct language (Go, Python, Rust, TypeScript):
1. Alice does not use Python or Rust.
2. Bob uses either Go or TypeScript.
3. Cara uses Rust.
4. Alice does not use Go.
Return JSON: {"Alice": "...", "Bob": "...", "Cara": "...", "Dan": "..."}`,
      maxTokens: 1536,
      referenceAnswer: JSON.stringify({
        Alice: 'TypeScript',
        Bob: 'Go',
        Cara: 'Rust',
        Dan: 'Python',
      }),
      grade: (output) => {
        try {
          const parsed = JSON.parse(extractJsonPayload(output)) as Record<string, string>;
          const ok =
            parsed.Alice === 'TypeScript' &&
            parsed.Bob === 'Go' &&
            parsed.Cara === 'Rust' &&
            parsed.Dan === 'Python';
          return { passed: ok, score: ok ? 1 : 0, detail: ok ? '4/4 deduced' : 'Logic mismatch' };
        } catch {
          return { passed: false, score: 0, detail: 'Invalid logic JSON' };
        }
      },
    },

    {
      id: 'reason-rate-math',
      pillar: 'reasoning',
      title: 'Staggered Work-Rate Problem',
      systemPrompt: 'Solve the rate problem accurately. End with `ANSWER: <integer>`.',
      userPrompt: `Worker A processes ${rateA} items/minute. Worker B processes ${rateB} items/minute.
Worker A starts alone for ${leadMins} minutes, then Worker B joins and both work together until ${workTarget} total items are processed.
How many total minutes did it take from start to finish? End with \`ANSWER: <integer>\`.`,
      maxTokens: 1536,
      referenceAnswer: `ANSWER: ${totalMins}`,
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const match = clean.match(/ANSWER:\s*(-?\d+)/i) ?? clean.match(/(-?\d+)\s*$/);
        const got = match?.[1] ? Number(match[1]) : NaN;
        const ok = got === totalMins;
        return { passed: ok, score: ok ? 1 : 0, detail: `got=${got}, expected=${totalMins}` };
      },
    },

    {
      id: 'reason-needle-haystack',
      pillar: 'reasoning',
      title: '2-Hop Multi-Needle Log Retrieval',
      systemPrompt: 'Read the full log carefully. Output ONLY `CODE: <value>`.',
      userPrompt: `Find the assigned codename in the SECURITY_NOTICE line, then look up that codename's \`vault_code\` in RECOVERY_KEY_MAP.
Return ONLY \`CODE: <vault_code>\`.

${haystackText}`,
      maxTokens: 512,
      referenceAnswer: `CODE: ${vaultCode}`,
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const ok = clean.toUpperCase().includes(vaultCode.toUpperCase());
        return { passed: ok, score: ok ? 1 : 0, detail: ok ? 'Found 2-hop needle' : 'Needle missed' };
      },
    },
  ];

  return prompts;
}
