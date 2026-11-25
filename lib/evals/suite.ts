import { z } from 'zod';
import {
  extractCodeBlock,
  extractJsonPayload,
  runSandboxedJsTests,
  stripThinkingTags,
} from './sandbox';
import type { EvalGradeResult, EvalMessage, EvalPrompt } from './types';

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

function shuffle<T>(rng: () => number, items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ratioGrade(passedCount: number, totalCount: number, detail: string): EvalGradeResult {
  const score = totalCount > 0 ? round2(passedCount / totalCount) : 0;
  return {
    passed: totalCount > 0 && passedCount === totalCount,
    score,
    detail,
  };
}

function makeCodePrompt(
  id: string,
  title: string,
  userPrompt: string,
  referenceAnswer: string,
  harnessCode: string,
  maxTokens: number = 4096
): EvalPrompt {
  return {
    id,
    pillar: 'coding',
    title,
    systemPrompt:
      'You are an expert JavaScript engineer. Output only valid standalone JavaScript code (no imports, no tests, no prose).',
    userPrompt,
    maxTokens,
    referenceAnswer,
    grade: async (output) => {
      const code = extractCodeBlock(output);
      if (!code) {
        return { passed: false, score: 0, detail: 'Empty code output' };
      }
      const res = await runSandboxedJsTests(code, harnessCode, 1500);
      if (res.error) {
        const denom = Math.max(res.totalTests + 1, 1);
        const score = round2(res.passedTests / denom);
        return {
          passed: false,
          score,
          detail: `${res.passedTests}/${res.totalTests} tests (${res.error})`,
        };
      }
      return ratioGrade(res.passedTests, res.totalTests, `${res.passedTests}/${res.totalTests} tests`);
    },
  };
}

function generatePermutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const head = items[i]!;
    const rest = items.filter((_, idx) => idx !== i);
    for (const sub of generatePermutations(rest)) {
      result.push([head, ...sub]);
    }
  }
  return result;
}

function modNorm(n: number, mod: number): number {
  return ((n % mod) + mod) % mod;
}

function modInvPrime(a: number, p: number): number {
  let t = 0;
  let newT = 1;
  let r = p;
  let newR = modNorm(a, p);
  while (newR !== 0) {
    const q = Math.floor(r / newR);
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  return modNorm(t, p);
}

/**
 * Generates the deterministic 20-prompt FB-Eval v2 Frontier Calibration Suite
 * parameterized by `seedTag` (`YYYY-MM`).
 */
export function buildEvalSuite(seedTag: string = getCurrentSeedTag()): EvalPrompt[] {
  const rng = createSeededRng(`fb-eval-v2:${seedTag}`);

  const exprConstA = randInt(rng, 4, 12);
  const exprConstB = randInt(rng, 2, 5);
  const exprRecN = randInt(rng, 4, 6);
  const sheetBase = randInt(rng, 3, 9);
  const sheetDelta = randInt(rng, 2, 6);

  const rlCapacity = randInt(rng, 3, 5);
  const rlRefillPerSec = randInt(rng, 2, 4);
  const rlFailThreshold = 2;
  const rlCooldownMs = randInt(rng, 4, 7) * 1000;

  const sqlThreshold = randInt(rng, 50, 75);
  const sqlBonus = randInt(rng, 2, 7);

  const prompts: EvalPrompt[] = [
    // ======================== 1. CODING (6) ========================
    makeCodePrompt(
      'code-v2-cron-next',
      'UTC Cron Next-Run Scheduler (with L)',
      `Write a JavaScript function \`nextCronUtc(expr, fromIsoUtc)\` for a 5-field UTC cron expression (\`minute hour dayOfMonth month dayOfWeek\`, where \`dayOfWeek\` uses \`0\` or \`7\` for Sunday).
Requirements:
- Support \`*\`, \`*/step\`, \`a-b\`, \`a-b/step\`, \`a/step\` (meaning \`a..max/step\`), and comma lists.
- Support \`L\` in \`dayOfMonth\` to match the last day of that month (handling 28/29/30/31-day months and leap years).
- Strict POSIX DOM/DOW rule: if BOTH \`dayOfMonth\` and \`dayOfWeek\` are restricted (neither is \`*\`), match a date if EITHER matches; if only one is restricted, match that field.
- Return the first matching timestamp strictly AFTER \`fromIsoUtc\` (even if \`fromIsoUtc\` has non-zero seconds) as an ISO-8601 UTC string (\`YYYY-MM-DDTHH:MM:00.000Z\`).`,
      `function nextCronUtc(expr, fromIsoUtc) {
  function parseField(field, min, max, mapSevenToZero) {
    const allowed = new Set();
    let hasLast = false;
    for (const part of field.split(',')) {
      if (part === 'L') {
        hasLast = true;
        continue;
      }
      const [rangePart, stepPart] = part.split('/');
      const step = stepPart ? Number(stepPart) : 1;
      let start = min;
      let end = max;
      if (rangePart !== '*') {
        if (rangePart.includes('-')) {
          const [a, b] = rangePart.split('-').map(Number);
          start = a;
          end = b;
        } else {
          start = Number(rangePart);
          end = stepPart ? max : start;
        }
      }
      for (let v = start; v <= end; v += step) {
        allowed.add(mapSevenToZero && v === 7 ? 0 : v);
      }
    }
    return { allowed, hasLast };
  }
  const [minF, hourF, domF, monF, dowF] = expr.trim().split(/\\s+/);
  const mins = parseField(minF, 0, 59, false).allowed;
  const hours = parseField(hourF, 0, 23, false).allowed;
  const domParsed = parseField(domF, 1, 31, false);
  const mons = parseField(monF, 1, 12, false).allowed;
  const dows = parseField(dowF, 0, 7, true).allowed;
  const domWild = domF === '*';
  const dowWild = dowF === '*';

  let ts = Math.floor(Date.parse(fromIsoUtc) / 60000) * 60000 + 60000;
  for (let i = 0; i < 60 * 24 * 366 * 8; i += 1) {
    const d = new Date(ts);
    const mon = d.getUTCMonth() + 1;
    if (!mons.has(mon)) {
      ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0);
      continue;
    }
    const dom = d.getUTCDate();
    const lastDom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const domMatch = domParsed.allowed.has(dom) || (domParsed.hasLast && dom === lastDom);
    const dow = d.getUTCDay();
    const dowMatch = dows.has(dow);
    const dayOk = !domWild && !dowWild
      ? domMatch || dowMatch
      : (domWild || domMatch) && (dowWild || dowMatch);
    if (!dayOk) {
      ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dom + 1, 0, 0, 0);
      continue;
    }
    const hr = d.getUTCHours();
    if (!hours.has(hr)) {
      ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dom, hr + 1, 0, 0);
      continue;
    }
    if (mins.has(d.getUTCMinutes())) {
      return d.toISOString();
    }
    ts += 60000;
  }
  throw new Error('No match found');
}`,
      `
        __record(nextCronUtc('10-35/8 14 * * *', '2026-11-24T14:18:00.000Z') === '2026-11-24T14:26:00.000Z');
        __record(nextCronUtc('0 0 29 2 *', '2026-03-01T00:00:00.000Z') === '2028-02-29T00:00:00.000Z');
        __record(nextCronUtc('0 9 15 * 1', '2026-11-01T00:00:00.000Z') === '2026-11-02T09:00:00.000Z');
        __record(nextCronUtc('0 12 L 2 *', '2027-02-01T00:00:00.000Z') === '2027-02-28T12:00:00.000Z');
        __record(nextCronUtc('0 12 L 2 *', '2028-02-01T00:00:00.000Z') === '2028-02-29T12:00:00.000Z');
        __record(nextCronUtc('5/20 * * * *', '2026-11-24T10:05:30.000Z') === '2026-11-24T10:25:00.000Z');
        __record(nextCronUtc('0,30 */6 * * 7', '2026-11-22T06:00:00.000Z') === '2026-11-22T06:30:00.000Z');
      `,
      4096
    ),

    makeCodePrompt(
      'code-v2-diff-patch',
      'Multi-Hunk Unified Diff Applier',
      `Write a JavaScript function \`applyUnifiedPatch(originalText, patchText)\` that applies a unified diff (\`@@ -oldStart[,oldCount] +newStart[,newCount] @@\`, ignoring \`---\`/\`+++\` headers).
Requirements:
- Support omitted counts (e.g. \`@@ -3 +3 @@\` meaning count=1), empty-file creation (\`@@ -0,0 +1,2 @@\`), and full-file deletion (\`@@ -1,2 +0,0 @@\`).
- Verify every context (\` \`) and deletion (\`-\`) line matches the original text; throw an \`Error\` on mismatch or out-of-range hunk.
- Track cumulative line-offset shifts across multiple hunks.
- Handle \`\\ No newline at end of file\` markers accurately so trailing newline presence/removal matches the patched output.`,
      `function applyUnifiedPatch(originalText, patchText) {
  const hadNewline = originalText.endsWith('\\n');
  const origLines = originalText === '' ? [] : originalText.split('\\n');
  if (hadNewline) origLines.pop();
  const patchLines = patchText === '' ? [] : patchText.split('\\n');
  const hunks = [];
  let cur = null;
  for (const line of patchLines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    const m = line.match(/^@@\\s+-(\\d+)(?:,(\\d+))?\\s+\\+(\\d+)(?:,(\\d+))?\\s+@@/);
    if (m) {
      cur = { oldStart: Number(m[1]), oldCount: m[2] !== undefined ? Number(m[2]) : 1, newCount: m[4] !== undefined ? Number(m[4]) : 1, ops: [] };
      hunks.push(cur);
    } else if (cur) {
      if (line === '\\\\ No newline at end of file') {
        const last = cur.ops[cur.ops.length - 1];
        if (last) last.noNewline = true;
      } else if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-')) {
        cur.ops.push({ tag: line[0], text: line.slice(1), noNewline: false });
      }
    }
  }
  const out = [];
  let origIdx = 0;
  let resultHasNewline = originalText === '' ? false : hadNewline;
  for (const hunk of hunks) {
    const targetIdx = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (targetIdx < origIdx || targetIdx > origLines.length) {
      throw new Error('Hunk out of range');
    }
    while (origIdx < targetIdx) {
      out.push(origLines[origIdx]);
      origIdx += 1;
    }
    if (hunk.newCount === 0 && hunk.oldStart === 1 && hunk.oldCount === origLines.length) {
      resultHasNewline = false;
    }
    for (const op of hunk.ops) {
      if (op.tag === ' ') {
        if (origLines[origIdx] !== op.text) throw new Error('Context mismatch');
        out.push(origLines[origIdx]);
        origIdx += 1;
        if (op.noNewline) resultHasNewline = false;
      } else if (op.tag === '-') {
        if (origLines[origIdx] !== op.text) throw new Error('Delete mismatch');
        origIdx += 1;
      } else if (op.tag === '+') {
        out.push(op.text);
        resultHasNewline = !op.noNewline;
      }
    }
  }
  while (origIdx < origLines.length) {
    out.push(origLines[origIdx]);
    origIdx += 1;
  }
  if (out.length === 0) return '';
  return out.join('\\n') + (resultHasNewline ? '\\n' : '');
}`,
      `
        const src = 'a\\nb\\nc\\nd\\ne\\nf\\n';
        const patch = [
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1,2 +1,4 @@',
          ' a',
          '+x1',
          '+x2',
          ' b',
          '@@ -5,2 +7,2 @@',
          '-e',
          '+E_NEW',
          ' f',
        ].join('\\n');
        __record(applyUnifiedPatch(src, patch) === 'a\\nx1\\nx2\\nb\\nc\\nd\\nE_NEW\\nf\\n');
        __record(applyUnifiedPatch('', '@@ -0,0 +1,2 @@\\n+hello\\n+world') === 'hello\\nworld\\n');
        __record(applyUnifiedPatch('p\\nq\\n', '@@ -1,2 +0,0 @@\\n-p\\n-q') === '');
        __record(applyUnifiedPatch('a\\nb\\n', '@@ -2 +2 @@\\n-b\\n+b_no_nl\\n\\\\ No newline at end of file') === 'a\\nb_no_nl');
        __record(applyUnifiedPatch('a\\nb', '@@ -2 +2 @@\\n-b\\n\\\\ No newline at end of file\\n+b_nl') === 'a\\nb_nl\\n');
        let threw = false;
        try { applyUnifiedPatch('a\\nb\\n', '@@ -1,2 +1,2 @@\\n a\\n-WRONG\\n+c'); } catch { threw = true; }
        __record(threw === true);
        __record(applyUnifiedPatch('x\\ny\\n', '') === 'x\\ny\\n');
      `,
      4096
    ),

    makeCodePrompt(
      'code-v2-expr-lang',
      'Mini Functional Expression Language',
      `Write a JavaScript function \`evalProgram(source)\` (WITHOUT using \`eval\` or \`Function\`) that evaluates semicolon-separated statements ending with a final expression:
- Statements:
  - \`let <ident> = <expr>\` (assigns or updates variable in global scope)
  - \`fn <name>(<p1>, <p2>, ...) = <expr>\` (defines a possibly recursive function with lexical parameters that shadow without mutating outer variables)
  - \`<expr>\` (evaluates and becomes the return value of the last statement)
- Operators (lowest to highest precedence):
  1. Ternary \`cond ? a : b\` (right-associative, short-circuit: untaken branch MUST NOT evaluate!)
  2. Comparisons \`<\`, \`<=\`, \`>\`, \`>=\`, \`==\`, \`!=\` returning \`1\` or \`0\`
  3. Additive \`+\`, \`-\`
  4. Multiplicative \`*\`, \`/\`, \`//\` (\`Math.floor(a / b)\`), \`%\` (Python-style non-negative modulo \`((a % b) + b) % b\` for positive \`b\`)
  5. Unary \`+\`, \`-\`
  6. Right-associative \`^\` (higher precedence than unary \`-\`, so \`-2^2 === -4\` and \`2^3^2 === 512\`)
  7. Primaries: numbers, identifiers, function calls \`name(arg1, arg2)\`, parenthesized expressions.
- Throw an \`Error\` on undefined variables/functions or division/modulo by zero.`,
      `function evalProgram(source) {
  function tokenize(str) {
    const toks = [];
    let i = 0;
    while (i < str.length) {
      const ch = str[i];
      if (/\\s/.test(ch)) { i += 1; continue; }
      const two = str.slice(i, i + 2);
      if (two === '//' || two === '<=' || two === '>=' || two === '==' || two === '!=') {
        toks.push({ t: two });
        i += 2;
        continue;
      }
      if ('+-*/%^?:(),=<>'.includes(ch)) {
        toks.push({ t: ch });
        i += 1;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        while (j < str.length && /[0-9.]/.test(str[j])) j += 1;
        toks.push({ t: 'num', v: Number(str.slice(i, j)) });
        i = j;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < str.length && /[A-Za-z0-9_]/.test(str[j])) j += 1;
        toks.push({ t: 'id', v: str.slice(i, j) });
        i = j;
        continue;
      }
      throw new Error('Bad char ' + ch);
    }
    return toks;
  }

  const globals = Object.create(null);
  const fns = Object.create(null);

  function parseExprTokens(toks) {
    let pos = 0;
    const peek = () => toks[pos];
    const eat = () => { const cur = toks[pos]; pos += 1; return cur; };

    function parseTernary() {
      const cond = parseCmp();
      if (peek() && peek().t === '?') {
        eat();
        const tBranch = parseTernary();
        if (!peek() || eat().t !== ':') throw new Error('Expected :');
        const fBranch = parseTernary();
        return { k: 'tern', cond, tBranch, fBranch };
      }
      return cond;
    }
    function parseCmp() {
      let left = parseAdd();
      while (peek() && ['<', '<=', '>', '>=', '==', '!='].includes(peek().t)) {
        const op = eat().t;
        const right = parseAdd();
        left = { k: 'bin', op, left, right };
      }
      return left;
    }
    function parseAdd() {
      let left = parseMul();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        const op = eat().t;
        const right = parseMul();
        left = { k: 'bin', op, left, right };
      }
      return left;
    }
    function parseMul() {
      let left = parseUnary();
      while (peek() && (peek().t === '*' || peek().t === '/' || peek().t === '//' || peek().t === '%')) {
        const op = eat().t;
        const right = parseUnary();
        left = { k: 'bin', op, left, right };
      }
      return left;
    }
    function parseUnary() {
      if (peek() && (peek().t === '-' || peek().t === '+')) {
        const op = eat().t;
        return { k: 'un', op, expr: parseUnary() };
      }
      return parsePow();
    }
    function parsePow() {
      const base = parsePrimary();
      if (peek() && peek().t === '^') {
        eat();
        return { k: 'bin', op: '^', left: base, right: parseUnary() };
      }
      return base;
    }
    function parsePrimary() {
      const tok = eat();
      if (!tok) throw new Error('Unexpected EOF');
      if (tok.t === 'num') return { k: 'num', v: tok.v };
      if (tok.t === 'id') {
        if (peek() && peek().t === '(') {
          eat();
          const args = [];
          if (!peek() || peek().t !== ')') {
            while (true) {
              args.push(parseTernary());
              if (peek() && peek().t === ',') { eat(); continue; }
              break;
            }
          }
          if (!peek() || eat().t !== ')') throw new Error('Missing )');
          return { k: 'call', name: tok.v, args };
        }
        return { k: 'var', name: tok.v };
      }
      if (tok.t === '(') {
        const inner = parseTernary();
        if (!peek() || eat().t !== ')') throw new Error('Missing )');
        return inner;
      }
      throw new Error('Unexpected token ' + tok.t);
    }

    const ast = parseTernary();
    if (pos !== toks.length) throw new Error('Trailing tokens');
    return ast;
  }

  function evalAst(node, scope) {
    if (node.k === 'num') return node.v;
    if (node.k === 'var') {
      if (Object.prototype.hasOwnProperty.call(scope, node.name)) return scope[node.name];
      if (Object.prototype.hasOwnProperty.call(globals, node.name)) return globals[node.name];
      throw new Error('Undefined var ' + node.name);
    }
    if (node.k === 'un') {
      const v = evalAst(node.expr, scope);
      return node.op === '-' ? -v : v;
    }
    if (node.k === 'tern') {
      return evalAst(node.cond, scope) ? evalAst(node.tBranch, scope) : evalAst(node.fBranch, scope);
    }
    if (node.k === 'call') {
      const fn = fns[node.name];
      if (!fn) throw new Error('Undefined fn ' + node.name);
      const localScope = Object.create(null);
      for (let i = 0; i < fn.params.length; i += 1) {
        localScope[fn.params[i]] = evalAst(node.args[i], scope);
      }
      return evalAst(fn.body, localScope);
    }
    const a = evalAst(node.left, scope);
    const b = evalAst(node.right, scope);
    switch (node.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': if (b === 0) throw new Error('Div zero'); return a / b;
      case '//': if (b === 0) throw new Error('Div zero'); return Math.floor(a / b);
      case '%': if (b === 0) throw new Error('Div zero'); return ((a % b) + Math.abs(b)) % Math.abs(b);
      case '^': return Math.pow(a, b);
      case '<': return a < b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      default: throw new Error('Bad op ' + node.op);
    }
  }

  const stmts = source.split(';').map((s) => s.trim()).filter(Boolean);
  let last = 0;
  for (const s of stmts) {
    if (s.startsWith('let ')) {
      const eq = s.indexOf('=');
      const name = s.slice(4, eq).trim();
      globals[name] = evalAst(parseExprTokens(tokenize(s.slice(eq + 1))), Object.create(null));
      last = globals[name];
    } else if (s.startsWith('fn ')) {
      const eq = s.indexOf('=');
      const header = s.slice(3, eq).trim();
      const paren = header.indexOf('(');
      const name = header.slice(0, paren).trim();
      const paramsStr = header.slice(paren + 1, header.lastIndexOf(')')).trim();
      const params = paramsStr ? paramsStr.split(',').map((p) => p.trim()) : [];
      fns[name] = { params, body: parseExprTokens(tokenize(s.slice(eq + 1))) };
    } else {
      last = evalAst(parseExprTokens(tokenize(s)), Object.create(null));
    }
  }
  return last;
}`,
      `
        __record(evalProgram('-2^2') === -4);
        __record(evalProgram('2^3^2') === 512);
        __record(evalProgram('let x = ${exprConstA}; let y = -7 // ${exprConstB}; x * 2 + y') === ${exprConstA * 2 + Math.floor(-7 / exprConstB)});
        __record(evalProgram('-5 % 3') === 1);
        __record(evalProgram('let x = 0; x == 0 ? 42 : 10 / x') === 42);
        __record(evalProgram('let x = 99; fn fact(n) = n <= 1 ? 1 : n * fact(n - 1); fact(${exprRecN}) + x') === ${(() => { let f = 1; for (let i = 2; i <= exprRecN; i += 1) f *= i; return f + 99; })()});
        __record(evalProgram('let n = 10; fn addN(n, k) = n + k; addN(3, 4) * 10 + n') === 80);
        let zErr = false;
        try { evalProgram('1 ? 10 // (2 - 2) : 5'); } catch { zErr = true; }
        __record(zErr === true);
      `,
      4096
    ),

    makeCodePrompt(
      'code-v2-reactive-sheet',
      'Reactive Spreadsheet with Range Aggregates & Rollback',
      `Write a JavaScript function \`createSheet()\` returning \`{ setCell(id, valueOrFormula), getCell(id) }\`.
Requirements:
- Numeric values or \`=expr\` formulas supporting cell references (\`A1\`, \`B12\`), numbers, \`+\`, \`-\`, \`*\`, \`/\`, unary \`-\`, parentheses, and rectangular range functions \`SUM(A1:B2)\`, \`AVG(A1:B2)\`, \`MAX(A1:B2)\`, \`MIN(A1:B2)\` (expanding column letters A..Z and row numbers). Unset cells evaluate to \`0\`.
- Support diamond dependency recalculation when upstream cells change.
- **Transactional cycle detection:** If \`setCell\` introduces a direct, indirect, OR range-based dependency cycle (e.g. \`A2 = '=SUM(A1:A3)'\`), throw an \`Error\` AND roll back the cell to its previous value/unset state so subsequent \`getCell\` calls remain valid.`,
      `function createSheet() {
  const cells = new Map();
  function parseCellId(id) {
    const m = id.match(/^([A-Z]+)(\\d+)$/);
    return { col: m[1], row: Number(m[2]) };
  }
  function colToNum(col) {
    let n = 0;
    for (let i = 0; i < col.length; i += 1) n = n * 26 + (col.charCodeAt(i) - 64);
    return n;
  }
  function numToCol(n) {
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  function expandRange(a, b) {
    const p1 = parseCellId(a);
    const p2 = parseCellId(b);
    const c1 = Math.min(colToNum(p1.col), colToNum(p2.col));
    const c2 = Math.max(colToNum(p1.col), colToNum(p2.col));
    const r1 = Math.min(p1.row, p2.row);
    const r2 = Math.max(p1.row, p2.row);
    const list = [];
    for (let c = c1; c <= c2; c += 1) {
      for (let r = r1; r <= r2; r += 1) {
        list.push(numToCol(c) + String(r));
      }
    }
    return list;
  }
  function extractDeps(val) {
    if (typeof val !== 'string' || !val.startsWith('=')) return [];
    const expr = val.slice(1);
    const deps = new Set();
    const rangeRe = /(?:SUM|AVG|MAX|MIN)\\(([A-Z]+\\d+):([A-Z]+\\d+)\\)/g;
    let m;
    while ((m = rangeRe.exec(expr)) !== null) {
      for (const id of expandRange(m[1], m[2])) deps.add(id);
    }
    const stripped = expr.replace(rangeRe, ' ');
    for (const ref of stripped.match(/\\b[A-Z]+\\d+\\b/g) ?? []) {
      deps.add(ref);
    }
    return Array.from(deps);
  }
  function hasCycle() {
    const state = new Map();
    function dfs(node) {
      const st = state.get(node) ?? 0;
      if (st === 1) return true;
      if (st === 2) return false;
      state.set(node, 1);
      for (const dep of extractDeps(cells.get(node))) {
        if (dfs(dep)) return true;
      }
      state.set(node, 2);
      return false;
    }
    for (const id of cells.keys()) {
      if (dfs(id)) return true;
    }
    return false;
  }
  function evalFormula(expr, memo) {
    let i = 0;
    const peek = () => {
      while (i < expr.length && /\\s/.test(expr[i])) i += 1;
      return expr[i];
    };
    function parseAdd() {
      let left = parseMul();
      while (peek() === '+' || peek() === '-') {
        const op = expr[i++];
        const right = parseMul();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }
    function parseMul() {
      let left = parsePrimary();
      while (peek() === '*' || peek() === '/') {
        const op = expr[i++];
        const right = parsePrimary();
        left = op === '*' ? left * right : left / right;
      }
      return left;
    }
    function parsePrimary() {
      const ch = peek();
      if (ch === '-') { i += 1; return -parsePrimary(); }
      if (ch === '(') {
        i += 1;
        const v = parseAdd();
        if (peek() === ')') i += 1;
        return v;
      }
      if (/[A-Z]/.test(ch || '')) {
        let j = i;
        while (j < expr.length && /[A-Z0-9]/.test(expr[j])) j += 1;
        const ident = expr.slice(i, j);
        i = j;
        if ((ident === 'SUM' || ident === 'AVG' || ident === 'MAX' || ident === 'MIN') && peek() === '(') {
          i += 1;
          const close = expr.indexOf(')', i);
          const [startId, endId] = expr.slice(i, close).split(':').map((s) => s.trim());
          i = close + 1;
          const vals = expandRange(startId, endId).map((id) => compute(id, memo));
          if (ident === 'SUM') return vals.reduce((a, b) => a + b, 0);
          if (ident === 'AVG') return vals.reduce((a, b) => a + b, 0) / vals.length;
          if (ident === 'MAX') return Math.max(...vals);
          return Math.min(...vals);
        }
        return compute(ident, memo);
      }
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j += 1;
      const num = Number(expr.slice(i, j));
      i = j;
      return num;
    }
    return parseAdd();
  }
  function compute(id, memo) {
    if (memo.has(id)) return memo.get(id);
    const raw = cells.get(id);
    if (raw === undefined) return 0;
    const val = typeof raw === 'number' ? raw : raw.startsWith('=') ? evalFormula(raw.slice(1), memo) : Number(raw);
    memo.set(id, val);
    return val;
  }
  return {
    setCell(id, valueOrFormula) {
      const had = cells.has(id);
      const prev = cells.get(id);
      cells.set(id, valueOrFormula);
      if (hasCycle()) {
        if (had) cells.set(id, prev);
        else cells.delete(id);
        throw new Error('Cycle detected');
      }
    },
    getCell(id) {
      return compute(id, new Map());
    },
  };
}`,
      `
        const s = createSheet();
        s.setCell('A1', ${sheetBase});
        s.setCell('A2', ${sheetBase + sheetDelta});
        s.setCell('B1', '=A1 * 2');
        s.setCell('B2', '=A2 + 4');
        s.setCell('C1', '=SUM(A1:B2)');
        __record(s.getCell('C1') === ${sheetBase + (sheetBase + sheetDelta) + sheetBase * 2 + (sheetBase + sheetDelta + 4)});
        __record(s.getCell('D1') === 0 && s.getCell('D2') === 0);
        s.setCell('C2', '=AVG(A1:A2) + MAX(B1:B2) - MIN(A1:B2)');
        const avgA = (${sheetBase} + ${sheetBase + sheetDelta}) / 2;
        const maxB = Math.max(${sheetBase * 2}, ${sheetBase + sheetDelta + 4});
        const minAB = Math.min(${sheetBase}, ${sheetBase + sheetDelta}, ${sheetBase * 2}, ${sheetBase + sheetDelta + 4});
        __record(s.getCell('C2') === avgA + maxB - minAB);
        s.setCell('A1', ${sheetBase + 2});
        __record(s.getCell('C1') === ${(sheetBase + 2) + (sheetBase + sheetDelta) + (sheetBase + 2) * 2 + (sheetBase + sheetDelta + 4)});
        let rangeCycle = false;
        try { s.setCell('A2', '=SUM(A1:A3)'); } catch { rangeCycle = true; }
        __record(rangeCycle === true && s.getCell('A2') === ${sheetBase + sheetDelta});
        let directCycle = false;
        try { s.setCell('A1', '=C1 + 1'); } catch { directCycle = true; }
        __record(directCycle === true && s.getCell('A1') === ${sheetBase + 2});
        s.setCell('E1', '=-A1 + (B1 - 1)');
        __record(s.getCell('E1') === ${-(sheetBase + 2) + ((sheetBase + 2) * 2 - 1)});
        __record(s.getCell('Z9') === 0);
      `,
      4096
    ),

    makeCodePrompt(
      'code-v2-bugfix-resilience',
      'Debug Token-Bucket + Circuit Breaker Module',
      `Fix ALL 5 bugs in this \`ResilientLimiter\` class and return the corrected complete JavaScript class:
\`\`\`js
class ResilientLimiter {
  constructor({ capacity, refillPerSec, failureThreshold, cooldownMs, now = () => Date.now() }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.tokens = capacity;
    this.lastRefill = now();
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.halfOpenInFlight = false;
  }
  refill() {
    const elapsedSec = Math.floor((this.now() - this.lastRefill) / 1000); // Bug 1: truncates sub-second elapsed & skips clamp
    if (elapsedSec > 0) {
      this.tokens += elapsedSec * this.refillPerSec;
      this.lastRefill = this.now();
    }
  }
  tryAcquire() {
    this.refill();
    this.tokens -= 1; // Bug 2: deducts token before checking circuit state or availability
    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt > this.cooldownMs) { // Bug 3: should be >= and must allow only 1 HALF_OPEN probe at a time
        this.state = 'HALF_OPEN';
      } else {
        return false;
      }
    }
    return this.tokens >= 0;
  }
  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.halfOpenInFlight = false;
    }
    // Bug 5: CLOSED successes fail to reset consecutiveFailures
  }
  recordFailure() {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenInFlight = false;
      // Bug 4: failed HALF_OPEN probe must immediately re-OPEN with openedAt = now()
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}
\`\`\`
Requirements:
- Continuous fractional token refill clamped to \`[0, capacity]\` (only advance \`lastRefill\` when \`now > lastRefill\`).
- Never deduct a token if the circuit blocks the call or if \`tokens < 1\`.
- \`OPEN -> HALF_OPEN\` triggers at \`now() - openedAt >= cooldownMs\`, allowing exactly 1 concurrent probe (\`halfOpenInFlight\`) until \`recordSuccess()\` or \`recordFailure()\`.`,
      `class ResilientLimiter {
  constructor({ capacity, refillPerSec, failureThreshold, cooldownMs, now = () => Date.now() }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.tokens = capacity;
    this.lastRefill = now();
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.halfOpenInFlight = false;
  }
  refill() {
    const t = this.now();
    if (t > this.lastRefill) {
      const elapsedSec = (t - this.lastRefill) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.lastRefill = t;
    }
  }
  tryAcquire() {
    this.refill();
    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenInFlight = false;
      } else {
        return false;
      }
    }
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenInFlight || this.tokens < 1) return false;
      this.tokens -= 1;
      this.halfOpenInFlight = true;
      return true;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.halfOpenInFlight = false;
    }
    this.consecutiveFailures = 0;
  }
  recordFailure() {
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = this.now();
      this.halfOpenInFlight = false;
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}`,
      `
        let clk = 1000;
        const lim = new ResilientLimiter({
          capacity: ${rlCapacity},
          refillPerSec: ${rlRefillPerSec},
          failureThreshold: ${rlFailThreshold},
          cooldownMs: ${rlCooldownMs},
          now: () => clk,
        });
        for (let i = 0; i < ${rlCapacity}; i += 1) __record(lim.tryAcquire() === true);
        __record(lim.tryAcquire() === false);
        clk += 500;
        __record(lim.tryAcquire() === true); // 500ms * refillPerSec >= 1 token
        clk += 10000;
        lim.refill();
        __record(lim.tokens === ${rlCapacity}); // clamped at capacity
        lim.recordFailure();
        lim.recordSuccess();
        lim.recordFailure();
        __record(lim.state === 'CLOSED'); // failure count was reset on success
        lim.recordFailure();
        __record(lim.state === 'OPEN' && lim.tryAcquire() === false);
        const tokensBeforeOpen = lim.tokens;
        lim.tryAcquire();
        __record(lim.tokens === tokensBeforeOpen); // no token deducted while OPEN
        clk += ${rlCooldownMs};
        __record(lim.tryAcquire() === true && lim.state === 'HALF_OPEN' && lim.tryAcquire() === false);
        lim.recordFailure();
        __record(lim.state === 'OPEN');
      `,
      4096
    ),

    makeCodePrompt(
      'code-v2-mini-sql',
      'In-Memory Mini SQL Engine',
      `Write a JavaScript function \`runSql(tables, query)\` that executes a SQL query over \`tables\` (an object mapping table name -> array of row objects).
Support:
- \`SELECT <items>\` where items are \`col\`, \`table.col\`, \`col AS alias\`, or aggregates \`COUNT(*)\`, \`SUM(col)\`, \`AVG(col)\` (with optional \`AS alias\`).
- \`FROM <table>\` and optional \`INNER JOIN <table2> ON <t1.col> = <t2.col>\`.
- Optional \`WHERE <cond>\` supporting \`=\`, \`!=\`, \`>\`, \`>=\`, \`<\`, \`<=\` on numeric or \`'single-quoted'\` string literals, combined with \`AND\` / \`OR\` (\`AND\` has higher precedence than \`OR\`).
- Optional \`GROUP BY <col>\` (supports \`col\` or \`table.col\`).
- Optional \`HAVING <aggOrAlias> <op> <num>\` (e.g. \`HAVING COUNT(*) >= 2\` or \`HAVING total > 100\`).
- Optional \`ORDER BY <colOrAlias> [ASC|DESC]\` (defaults to \`ASC\`).
- Optional \`LIMIT <n>\`.
Return an array of plain row objects with the projected keys.`,
      `function runSql(tables, query) {
  const q = query.trim().replace(/;$/, '');
  const re = /^SELECT\\s+(.+?)\\s+FROM\\s+(\\w+)(?:\\s+INNER\\s+JOIN\\s+(\\w+)\\s+ON\\s+([\\w.]+)\\s*=\\s*([\\w.]+))?(?:\\s+WHERE\\s+(.+?))?(?:\\s+GROUP\\s+BY\\s+([\\w.]+))?(?:\\s+HAVING\\s+(.+?))?(?:\\s+ORDER\\s+BY\\s+([\\w.*()]+)(?:\\s+(ASC|DESC))?)?(?:\\s+LIMIT\\s+(\\d+))?$/i;
  const m = q.match(re);
  if (!m) throw new Error('Invalid SQL');
  const [, selectStr, fromTbl, joinTbl, joinL, joinR, whereStr, groupCol, havingStr, orderCol, orderDir, limitStr] = m;

  function getVal(row, key) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    const short = key.includes('.') ? key.split('.')[1] : key;
    return row[short];
  }

  let rows = (tables[fromTbl] ?? []).map((r) => {
    const out = { ...r };
    for (const [k, v] of Object.entries(r)) out[fromTbl + '.' + k] = v;
    return out;
  });

  if (joinTbl) {
    const rightRows = tables[joinTbl] ?? [];
    const joined = [];
    for (const lr of rows) {
      for (const rr of rightRows) {
        const rrPref = {};
        for (const [k, v] of Object.entries(rr)) rrPref[joinTbl + '.' + k] = v;
        const lv = getVal(lr, joinL);
        const rv = getVal({ ...rr, ...rrPref }, joinR);
        if (lv === rv) {
          joined.push({ ...lr, ...rr, ...rrPref });
        }
      }
    }
    rows = joined;
  }

  function parseLiteral(raw) {
    const t = raw.trim();
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
    return Number(t);
  }
  function cmp(a, op, b) {
    if (op === '=') return a === b;
    if (op === '!=') return a !== b;
    if (op === '>') return a > b;
    if (op === '>=') return a >= b;
    if (op === '<') return a < b;
    if (op === '<=') return a <= b;
    return false;
  }

  if (whereStr) {
    const orParts = whereStr.split(/\\s+OR\\s+/i);
    rows = rows.filter((row) =>
      orParts.some((orPart) =>
        orPart.split(/\\s+AND\\s+/i).every((term) => {
          const tm = term.trim().match(/^([\\w.]+)\\s*(=|!=|>=|<=|>|<)\\s*(.+)$/);
          if (!tm) return false;
          return cmp(getVal(row, tm[1]), tm[2], parseLiteral(tm[3]));
        })
      )
    );
  }

  const projections = selectStr.split(',').map((part) => {
    const pm = part.trim().match(/^(.+?)(?:\\s+AS\\s+(\\w+))?$/i);
    const expr = pm[1].trim();
    const aggM = expr.match(/^(COUNT|SUM|AVG)\\(([*\\w.]+)\\)$/i);
    const defaultKey = aggM ? expr : expr.includes('.') ? expr.split('.')[1] : expr;
    return {
      expr,
      alias: pm[2] ?? defaultKey,
      agg: aggM ? aggM[1].toUpperCase() : null,
      aggArg: aggM ? aggM[2] : null,
    };
  });

  const hasAgg = projections.some((p) => p.agg !== null) || Boolean(groupCol);

  function evalAgg(agg, arg, groupRows) {
    if (agg === 'COUNT') return groupRows.length;
    const vals = groupRows.map((r) => Number(getVal(r, arg)));
    const sum = vals.reduce((a, b) => a + b, 0);
    return agg === 'SUM' ? sum : sum / vals.length;
  }

  let outRows = [];
  if (hasAgg) {
    const groups = new Map();
    if (groupCol) {
      for (const r of rows) {
        const key = getVal(r, groupCol);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
    } else if (rows.length > 0) {
      groups.set('__all__', rows);
    }
    for (const gRows of groups.values()) {
      const obj = {};
      for (const p of projections) {
        obj[p.alias] = p.agg ? evalAgg(p.agg, p.aggArg, gRows) : getVal(gRows[0], p.expr);
      }
      if (havingStr) {
        const hm = havingStr.trim().match(/^([\\w.*()]+)\\s*(=|!=|>=|<=|>|<)\\s*(.+)$/);
        if (hm) {
          const target = hm[1].trim();
          const hAgg = target.match(/^(COUNT|SUM|AVG)\\(([*\\w.]+)\\)$/i);
          const actual = hAgg ? evalAgg(hAgg[1].toUpperCase(), hAgg[2], gRows) : obj[target];
          if (!cmp(actual, hm[2], parseLiteral(hm[3]))) continue;
        }
      }
      outRows.push(obj);
    }
  } else {
    outRows = rows.map((r) => {
      const obj = {};
      for (const p of projections) obj[p.alias] = getVal(r, p.expr);
      return obj;
    });
  }

  if (orderCol) {
    const desc = (orderDir ?? 'ASC').toUpperCase() === 'DESC';
    outRows.sort((a, b) => {
      const av = a[orderCol];
      const bv = b[orderCol];
      const d = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return desc ? -d : d;
    });
  }

  if (limitStr !== undefined) {
    outRows = outRows.slice(0, Number(limitStr));
  }
  return outRows;
}`,
      `
        const db = {
          users: [
            { id: 1, name: 'Ada', team: 'core' },
            { id: 2, name: 'Ben', team: 'edge' },
            { id: 3, name: 'Cam', team: 'core' },
          ],
          runs: [
            { user_id: 1, score: ${sqlThreshold + 10}, status: 'ok' },
            { user_id: 1, score: ${sqlThreshold + 20}, status: 'ok' },
            { user_id: 2, score: ${sqlThreshold - 10}, status: 'fail' },
            { user_id: 3, score: ${sqlThreshold + sqlBonus}, status: 'ok' },
            { user_id: 3, score: ${sqlThreshold + sqlBonus + 10}, status: 'ok' },
          ],
        };
        const r1 = runSql(db, "SELECT name, team FROM users WHERE team = 'core' ORDER BY name DESC");
        __record(__deepEqual(r1, [{ name: 'Cam', team: 'core' }, { name: 'Ada', team: 'core' }]));
        const r2 = runSql(db, "SELECT user_id, score FROM runs WHERE status = 'ok' AND score >= ${sqlThreshold + 10} OR status = 'fail'");
        __record(r2.length === 4);
        const r3 = runSql(db, "SELECT users.name, SUM(runs.score) AS total FROM users INNER JOIN runs ON users.id = runs.user_id WHERE runs.status = 'ok' GROUP BY users.name HAVING total > ${sqlThreshold * 2 + 29} ORDER BY total DESC");
        __record(__deepEqual(r3, [{ name: 'Ada', total: ${(sqlThreshold + 10) + (sqlThreshold + 20)} }]));
        const r4 = runSql(db, "SELECT users.team, COUNT(*) AS cnt, AVG(runs.score) AS avg_s FROM users INNER JOIN runs ON users.id = runs.user_id GROUP BY users.team HAVING COUNT(*) >= 2 ORDER BY cnt DESC LIMIT 1");
        __record(r4.length === 1 && r4[0].team === 'core' && r4[0].cnt === 4);
        const r5 = runSql(db, "SELECT name FROM users ORDER BY id ASC LIMIT 2");
        __record(__deepEqual(r5, [{ name: 'Ada' }, { name: 'Ben' }]));
        const r6 = runSql(db, "SELECT COUNT(*) AS n FROM runs WHERE status = 'missing'");
        __record(__deepEqual(r6, []));
        const r7 = runSql(db, "SELECT user_id, SUM(score) AS s FROM runs GROUP BY user_id ORDER BY user_id ASC");
        __record(r7.length === 3 && r7[1].s === ${sqlThreshold - 10});
        const r8 = runSql(db, "SELECT name AS engineer FROM users WHERE id != 2 ORDER BY engineer ASC");
        __record(__deepEqual(r8, [{ engineer: 'Ada' }, { engineer: 'Cam' }]));
      `,
      4096
    ),
  ];

  // ======================== 2. FRONTIER REASONING & LONG-CONTEXT (6) ========================
  // 2a. 16-Step 4-Register Bitwise VM Trace
  let vm0 = randInt(rng, 10, 22);
  let vm1 = randInt(rng, 7, 17);
  let vm2 = randInt(rng, 4, 13);
  let vm3 = randInt(rng, 3, 11);
  const vmInit = [vm0, vm1, vm2, vm3] as const;
  const vmMask = randInt(rng, 5, 14);
  for (let step = 0; step < 16; step += 1) {
    const branch = vm0 % 3;
    if (branch === 0) {
      vm1 = (vm1 + vm2 + step) % 31;
      vm0 = Math.floor(vm0 / 2) + vm3;
    } else if (branch === 1) {
      vm2 = vm2 ^ ((vm0 + vmMask) % 16);
      vm0 = (vm0 * 3 + 1) % 29;
    } else {
      vm3 = (vm3 + (vm1 ^ step)) % 19;
      vm0 = (vm0 + vm2 + 5) % 27;
    }
    if (step % 4 === 3) {
      [vm0, vm1, vm2, vm3] = [vm1, vm2, vm3, vm0];
    }
  }

  // 2b. 6-Entity Scheduling CSP (guaranteed unique via 720-perm solver)
  const cspNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'] as const;
  const cspPerm = shuffle(rng, [1, 2, 3, 4, 5, 6]);
  const cspPos = new Map<string, number>(cspNames.map((n, idx) => [n, cspPerm[idx]!]));
  interface CspConstraint {
    text: string;
    check: (assign: Record<string, number>) => boolean;
  }
  const candidateRules: CspConstraint[] = [];
  const pAlpha = cspPos.get('Alpha')!;
  const pBeta = cspPos.get('Beta')!;
  const pGamma = cspPos.get('Gamma')!;
  const pDelta = cspPos.get('Delta')!;
  const pEpsilon = cspPos.get('Epsilon')!;
  const pZeta = cspPos.get('Zeta')!;

  candidateRules.push({
    text: pAlpha < pBeta ? 'Alpha is scheduled strictly before Beta.' : 'Beta is scheduled strictly before Alpha.',
    check: (a) => (pAlpha < pBeta ? a.Alpha! < a.Beta! : a.Beta! < a.Alpha!),
  });
  candidateRules.push({
    text: `Gamma is at an ${pGamma % 2 === 0 ? 'even' : 'odd'} slot.`,
    check: (a) => a.Gamma! % 2 === pGamma % 2,
  });
  candidateRules.push({
    text: `The slot difference |Delta - Epsilon| equals ${Math.abs(pDelta - pEpsilon)}.`,
    check: (a) => Math.abs(a.Delta! - a.Epsilon!) === Math.abs(pDelta - pEpsilon),
  });
  candidateRules.push({
    text:
      Math.abs(pZeta - pAlpha) === 1
        ? 'Zeta is immediately adjacent to Alpha (|Zeta - Alpha| = 1).'
        : 'Zeta is NOT immediately adjacent to Alpha (|Zeta - Alpha| != 1).',
    check: (a) =>
      Math.abs(pZeta - pAlpha) === 1
        ? Math.abs(a.Zeta! - a.Alpha!) === 1
        : Math.abs(a.Zeta! - a.Alpha!) !== 1,
  });
  const sumAB = pAlpha + pBeta;
  candidateRules.push({
    text: `Alpha + Beta = ${sumAB}.`,
    check: (a) => a.Alpha! + a.Beta! === sumAB,
  });
  const forbiddenSlot = ((pDelta % 6) + 1);
  candidateRules.push({
    text: `Delta is NOT in slot ${forbiddenSlot}.`,
    check: (a) => a.Delta! !== forbiddenSlot,
  });
  candidateRules.push({
    text: pGamma < pZeta ? 'Gamma is strictly before Zeta.' : 'Zeta is strictly before Gamma.',
    check: (a) => (pGamma < pZeta ? a.Gamma! < a.Zeta! : a.Zeta! < a.Gamma!),
  });

  const allPerms = generatePermutations([1, 2, 3, 4, 5, 6]).map((p) => {
    const obj: Record<string, number> = {};
    cspNames.forEach((n, idx) => {
      obj[n] = p[idx]!;
    });
    return obj;
  });

  const activeRules: CspConstraint[] = [...candidateRules];
  const pairPairs: Array<[typeof cspNames[number], typeof cspNames[number]]> = [
    ['Alpha', 'Gamma'],
    ['Beta', 'Delta'],
    ['Gamma', 'Epsilon'],
    ['Delta', 'Zeta'],
    ['Epsilon', 'Alpha'],
    ['Beta', 'Zeta'],
    ['Epsilon', 'Beta'],
    ['Gamma', 'Delta'],
  ];
  for (const [u, v] of pairPairs) {
    const matches = allPerms.filter((assign) => activeRules.every((r) => r.check(assign)));
    if (matches.length <= 1) break;
    const pu = cspPos.get(u)!;
    const pv = cspPos.get(v)!;
    activeRules.push({
      text: pu < pv ? `${u} is strictly before ${v}.` : `${v} is strictly before ${u}.`,
      check: (a) => (pu < pv ? a[u]! < a[v]! : a[v]! < a[u]!),
    });
  }

  // 2c. 2D Knapsack with Dependencies & Mutual Exclusion
  const knapItems = Array.from({ length: 9 }, (_, idx) => ({
    id: `S${idx + 1}`,
    cpu: randInt(rng, 2, 6),
    ram: randInt(rng, 3, 8),
    val: randInt(rng, 12, 35),
  }));
  const maxCpu = randInt(rng, 14, 18);
  const maxRam = randInt(rng, 18, 24);
  let bestVal = -1;
  let bestMask = 0;
  for (let mask = 0; mask < 1 << 9; mask += 1) {
    const has = (idx: number) => ((mask >> idx) & 1) === 1;
    // S4 (idx 3) requires S1 (idx 0); S7 (idx 6) requires S3 (idx 2); S2 (idx 1) and S5 (idx 4) mutually exclusive
    if (has(3) && !has(0)) continue;
    if (has(6) && !has(2)) continue;
    if (has(1) && has(4)) continue;
    let cpu = 0;
    let ram = 0;
    let val = 0;
    for (let i = 0; i < 9; i += 1) {
      if (has(i)) {
        cpu += knapItems[i]!.cpu;
        ram += knapItems[i]!.ram;
        val += knapItems[i]!.val;
      }
    }
    if (cpu <= maxCpu && ram <= maxRam && val > bestVal) {
      bestVal = val;
      bestMask = mask;
    }
  }
  const bestSelected = knapItems.filter((_, i) => ((bestMask >> i) & 1) === 1).map((x) => x.id);

  // 2d. Sprague-Grundy Restricted Take {1, 3, 4} Nim
  const grundy = new Array<number>(32).fill(0);
  for (let n = 1; n < grundy.length; n += 1) {
    const seen = new Set<number>();
    for (const take of [1, 3, 4]) {
      if (n - take >= 0) seen.add(grundy[n - take]!);
    }
    let g = 0;
    while (seen.has(g)) g += 1;
    grundy[n] = g;
  }
  let nimPiles = [12, 15, 19, 22];
  let nimSum = 0;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    nimPiles = [
      randInt(rng, 10, 25),
      randInt(rng, 10, 25),
      randInt(rng, 10, 25),
      randInt(rng, 10, 25),
    ];
    nimSum =
      grundy[nimPiles[0]!]! ^
      grundy[nimPiles[1]!]! ^
      grundy[nimPiles[2]!]! ^
      grundy[nimPiles[3]!]!;
    if (nimSum !== 0) break;
  }
  const pileGrundies = nimPiles.map((p) => grundy[p]!);
  let refWinMove = { pile_index: 0, take: 1 };
  for (let i = 0; i < 4; i += 1) {
    const targetG = pileGrundies[i]! ^ nimSum;
    for (const take of [1, 3, 4]) {
      if (nimPiles[i]! >= take && grundy[nimPiles[i]! - take] === targetG) {
        refWinMove = { pile_index: i, take };
        break;
      }
    }
  }

  // 2e. 2x2 Matrix Exponentiation Mod 97 + Determinant Inverse
  const m00 = randInt(rng, 2, 11);
  const m01 = randInt(rng, 1, 9);
  const m10 = randInt(rng, 1, 9);
  let m11 = randInt(rng, 2, 11);
  while (modNorm(m00 * m11 - m01 * m10, 97) === 0) {
    m11 += 1;
  }
  const matExp = randInt(rng, 13, 19);
  const matMul = (
    a: readonly [number, number, number, number],
    b: readonly [number, number, number, number]
  ): [number, number, number, number] => [
      modNorm(a[0] * b[0] + a[1] * b[2], 97),
      modNorm(a[0] * b[1] + a[1] * b[3], 97),
      modNorm(a[2] * b[0] + a[3] * b[2], 97),
      modNorm(a[2] * b[1] + a[3] * b[3], 97),
    ];
  let matAns: [number, number, number, number] = [1, 0, 0, 1];
  for (let i = 0; i < matExp; i += 1) {
    matAns = matMul(matAns, [m00, m01, m10, m11]);
  }
  const detInv = modInvPrime(m00 * m11 - m01 * m10, 97);

  // 2f. 20K+ Multi-Rule Superseding & Expired-Waiver Policy Log
  const pTag = `TIER-${randInt(rng, 40, 89)}A`;
  const decoyTag = `TIER-${randInt(rng, 10, 39)}B`;
  const pBaseQuota = randInt(rng, 300, 500);
  const polDelta = randInt(rng, 120, 220);
  const pMult1 = randInt(rng, 2, 3);
  const pMult2 = pMult1 + 2;
  const pRegion1 = pick(rng, ['eu-west-1', 'ap-south-1']);
  const pRegion2 = pick(rng, ['us-west-2', 'ca-central-1']);
  const logLines: string[] = [];
  for (let i = 1; i <= 110; i += 1) {
    if (i === 15) {
      logLines.push(
        `[015] 2026-09-01 BASE_POLICY tag=${pTag} quota=${pBaseQuota} burst_multiplier=${pMult1} failback_region=${pRegion1} audit_level=standard`
      );
    } else if (i === 30) {
      logLines.push(
        `[030] 2026-09-18 BASE_POLICY tag=${decoyTag} quota=${pBaseQuota + 777} burst_multiplier=9 failback_region=ap-northeast-1 audit_level=relaxed`
      );
    } else if (i === 42) {
      logLines.push(
        `[042] 2026-10-01 TEMP_WAIVER tag=${pTag} expires=2026-10-15 quota=9999 audit_level=none (temporary override until expires date)`
      );
    } else if (i === 68) {
      logLines.push(
        `[068] 2026-10-20 REGION_OVERRIDE tag=${pTag} failback_region=${pRegion2} audit_level=strict`
      );
    } else if (i === 79) {
      logLines.push(
        `[079] 2026-11-02 AMENDMENT tag=${decoyTag} quota=1111 failback_region=sa-east-1`
      );
    } else if (i === 88) {
      logLines.push(
        `[088] 2026-11-08 AMENDMENT_V2 tag=${pTag} quota=BASE+${polDelta} burst_multiplier=${pMult2}`
      );
    } else if (i === 104) {
      logLines.push(
        `[104] 2026-11-15 PARTIAL_ROLLBACK tag=${pTag} revert_only=audit_level to standard`
      );
    } else {
      logLines.push(
        `[${String(i).padStart(3, '0')}] 2026-11-01 HEARTBEAT worker=pool-${i % 9} region=us-east-1 latency_ms=${11 + (i % 19)} status=200 digest=${(i * 131) % 997}`
      );
    }
  }
  const conflictHaystack = logLines.join('\n');

  prompts.push(
    {
      id: 'reason-v2-vm-16step',
      pillar: 'reasoning',
      title: '16-Step 4-Register Bitwise VM Trace',
      systemPrompt:
        'Simulate every iteration carefully. Output ONLY JSON: {"R0": int, "R1": int, "R2": int, "R3": int}.',
      userPrompt: `Simulate this 4-register VM for \`step = 0, 1, ..., 15\` (16 iterations), starting with \`R0=${vmInit[0]}, R1=${vmInit[1]}, R2=${vmInit[2]}, R3=${vmInit[3]}\`:
In each iteration:
1. Inspect \`R0 % 3\`:
   - If \`R0 % 3 === 0\`: \`R1 = (R1 + R2 + step) % 31\`; \`R0 = Math.floor(R0 / 2) + R3\`
   - Else if \`R0 % 3 === 1\`: \`R2 = R2 ^ ((R0 + ${vmMask}) % 16)\` (bitwise XOR); \`R0 = (R0 * 3 + 1) % 29\`
   - Else (\`R0 % 3 === 2\`): \`R3 = (R3 + (R1 ^ step)) % 19\`; \`R0 = (R0 + R2 + 5) % 27\`
2. End-of-iteration rotation: if \`step % 4 === 3\`, rotate registers left: \`[R0, R1, R2, R3] = [R1, R2, R3, R0]\`.
Return ONLY JSON: \`{"R0": <int>, "R1": <int>, "R2": <int>, "R3": <int>}\`.`,
      maxTokens: 4096,
      referenceAnswer: JSON.stringify({ R0: vm0, R1: vm1, R2: vm2, R3: vm3 }),
      grade: (output) => {
        try {
          const p = JSON.parse(extractJsonPayload(output)) as Record<string, unknown>;
          const matched =
            (p.R0 === vm0 ? 1 : 0) +
            (p.R1 === vm1 ? 1 : 0) +
            (p.R2 === vm2 ? 1 : 0) +
            (p.R3 === vm3 ? 1 : 0);
          return ratioGrade(matched, 4, `${matched}/4 registers matched`);
        } catch {
          return { passed: false, score: 0, detail: 'Invalid VM JSON' };
        }
      },
    },

    {
      id: 'reason-v2-csp-6entity',
      pillar: 'reasoning',
      title: '6-Entity Unique Scheduling CSP',
      systemPrompt: 'Solve the constraint satisfaction puzzle and output ONLY JSON.',
      userPrompt: `Assign each of the 6 services (\`Alpha\`, \`Beta\`, \`Gamma\`, \`Delta\`, \`Epsilon\`, \`Zeta\`) to a distinct slot \`1, 2, 3, 4, 5, 6\` satisfying ALL constraints:
${activeRules.map((r, idx) => `${idx + 1}. ${r.text}`).join('\n')}
Return ONLY JSON: \`{"Alpha": <int>, "Beta": <int>, "Gamma": <int>, "Delta": <int>, "Epsilon": <int>, "Zeta": <int>}\`.`,
      maxTokens: 4096,
      referenceAnswer: JSON.stringify(Object.fromEntries(cspNames.map((n) => [n, cspPos.get(n)!]))),
      grade: (output) => {
        try {
          const p = JSON.parse(extractJsonPayload(output)) as Record<string, unknown>;
          const matched = cspNames.filter((n) => p[n] === cspPos.get(n)).length;
          return ratioGrade(matched, 6, `${matched}/6 slots matched`);
        } catch {
          return { passed: false, score: 0, detail: 'Invalid CSP JSON' };
        }
      },
    },

    {
      id: 'reason-v2-knapsack-dep',
      pillar: 'reasoning',
      title: '2D Knapsack with Prerequisites & Exclusions',
      systemPrompt: 'Find the exact maximum-value feasible subset. Output ONLY JSON.',
      userPrompt: `Select a subset of services \`S1..S9\` maximizing total \`value\` subject to:
- Total \`cpu <= ${maxCpu}\` and total \`ram <= ${maxRam}\`
- Prerequisite 1: \`S4\` may only be selected if \`S1\` is also selected.
- Prerequisite 2: \`S7\` may only be selected if \`S3\` is also selected.
- Mutual exclusion: \`S2\` and \`S5\` CANNOT both be selected.
Items:
${knapItems.map((it) => `- ${it.id}: cpu=${it.cpu}, ram=${it.ram}, value=${it.val}`).join('\n')}
Return ONLY JSON: \`{"max_value": <int>, "selected": ["S...", ...]}\`.`,
      maxTokens: 4096,
      referenceAnswer: JSON.stringify({ max_value: bestVal, selected: bestSelected }),
      grade: (output) => {
        const schema = z.object({
          max_value: z.number().int(),
          selected: z.array(z.string()),
        });
        try {
          const parsed = schema.parse(JSON.parse(extractJsonPayload(output)));
          const sel = new Set(parsed.selected);
          const byId = new Map(knapItems.map((it) => [it.id, it]));
          let cpu = 0;
          let ram = 0;
          let val = 0;
          let validIds = sel.size === parsed.selected.length;
          for (const id of sel) {
            const item = byId.get(id);
            if (!item) { validIds = false; break; }
            cpu += item.cpu;
            ram += item.ram;
            val += item.val;
          }
          const depsOk =
            (!sel.has('S4') || sel.has('S1')) &&
            (!sel.has('S7') || sel.has('S3')) &&
            !(sel.has('S2') && sel.has('S5'));
          const feasible = validIds && depsOk && cpu <= maxCpu && ram <= maxRam && val === parsed.max_value;
          const optimal = parsed.max_value === bestVal;
          const checks = (feasible ? 1 : 0) + (feasible && optimal ? 1 : 0);
          return ratioGrade(
            checks,
            2,
            `feasible=${feasible}, gotVal=${parsed.max_value}, best=${bestVal}`
          );
        } catch {
          return { passed: false, score: 0, detail: 'Invalid knapsack JSON' };
        }
      },
    },

    {
      id: 'reason-v2-nim-grundy',
      pillar: 'reasoning',
      title: 'Restricted Subtraction Nim (Sprague-Grundy)',
      systemPrompt: 'Compute exact Grundy values and a winning move. Output ONLY JSON.',
      userPrompt: `Four piles have sizes \`[${nimPiles.join(', ')}]\` (0-indexed: piles 0, 1, 2, 3).
On a turn, a player chooses one pile and removes **1, 3, or 4** stones (normal play: last move wins).
Compute:
1. \`grundy_values\`: array of the 4 Sprague-Grundy numbers \`[g0, g1, g2, g3]\`
2. \`nim_sum\`: bitwise XOR \`g0 ^ g1 ^ g2 ^ g3\`
3. \`winning_move\`: \`{"pile_index": <0..3>, "take": <1|3|4>}\` leaving the resulting nim-sum equal to \`0\`.
Return ONLY JSON.`,
      maxTokens: 4096,
      referenceAnswer: JSON.stringify({
        grundy_values: pileGrundies,
        nim_sum: nimSum,
        winning_move: refWinMove,
      }),
      grade: (output) => {
        const schema = z.object({
          grundy_values: z.array(z.number().int()).length(4),
          nim_sum: z.number().int(),
          winning_move: z.object({
            pile_index: z.number().int().min(0).max(3),
            take: z.number().int(),
          }),
        });
        try {
          const p = schema.parse(JSON.parse(extractJsonPayload(output)));
          const gOk = p.grundy_values.every((v, idx) => v === pileGrundies[idx]);
          const sumOk = p.nim_sum === nimSum;
          const mv = p.winning_move;
          const validTake = mv.take === 1 || mv.take === 3 || mv.take === 4;
          const enough = nimPiles[mv.pile_index]! >= mv.take;
          const newG = enough ? grundy[nimPiles[mv.pile_index]! - mv.take]! : -1;
          const postXor =
            validTake && enough ? (nimSum ^ pileGrundies[mv.pile_index]! ^ newG) : -1;
          const moveOk = postXor === 0;
          const passedChecks = (gOk ? 1 : 0) + (sumOk ? 1 : 0) + (moveOk ? 1 : 0);
          return ratioGrade(
            passedChecks,
            3,
            `grundy=${gOk}, nim_sum=${sumOk}, win_move=${moveOk}`
          );
        } catch {
          return { passed: false, score: 0, detail: 'Invalid Nim JSON' };
        }
      },
    },

    {
      id: 'reason-v2-matrix-mod',
      pillar: 'reasoning',
      title: '2x2 Matrix Exponentiation & Modular Inverse (mod 97)',
      systemPrompt: 'Compute exact modulo 97 integers in [0, 96]. Output ONLY JSON.',
      userPrompt: `Let \`M = [[${m00}, ${m01}], [${m10}, ${m11}]]\`.
Compute \`M^${matExp} mod 97 = [[r00, r01], [r10, r11]]\` and \`det_inv\`, the modular multiplicative inverse of \`det(M) = (${m00}*${m11} - ${m01}*${m10})\` modulo \`97\` (all values integers in \`0..96\`).
Return ONLY JSON: \`{"r00": <int>, "r01": <int>, "r10": <int>, "r11": <int>, "det_inv": <int>}\`.`,
      maxTokens: 4096,
      referenceAnswer: JSON.stringify({
        r00: matAns[0],
        r01: matAns[1],
        r10: matAns[2],
        r11: matAns[3],
        det_inv: detInv,
      }),
      grade: (output) => {
        try {
          const p = JSON.parse(extractJsonPayload(output)) as Record<string, unknown>;
          const matched =
            (p.r00 === matAns[0] ? 1 : 0) +
            (p.r01 === matAns[1] ? 1 : 0) +
            (p.r10 === matAns[2] ? 1 : 0) +
            (p.r11 === matAns[3] ? 1 : 0) +
            (p.det_inv === detInv ? 1 : 0);
          return ratioGrade(matched, 5, `${matched}/5 matrix entries matched`);
        } catch {
          return { passed: false, score: 0, detail: 'Invalid matrix JSON' };
        }
      },
    },

    {
      id: 'reason-v2-needle-conflict',
      pillar: 'reasoning',
      title: '11K-Char Conflicting & Expired Policy Resolution',
      systemPrompt:
        'Read the full operational log carefully and resolve the effective policy on 2026-11-20. Output ONLY JSON.',
      userPrompt: `Determine the effective policy for \`tag=${pTag}\` on target date \`2026-11-20\`.
Rules:
- Ignore unrelated tags (such as \`${decoyTag}\`).
- Any \`TEMP_WAIVER\` whose \`expires\` date is before \`2026-11-20\` has expired and MUST NOT apply.
- Apply active overrides/amendments and partial rollbacks in chronological order.
Return ONLY JSON: \`{"quota": <int>, "burst_multiplier": <int>, "failback_region": "<str>", "audit_level": "<str>"}\`.

${conflictHaystack}`,
      maxTokens: 1536,
      referenceAnswer: JSON.stringify({
        quota: pBaseQuota + polDelta,
        burst_multiplier: pMult2,
        failback_region: pRegion2,
        audit_level: 'standard',
      }),
      grade: (output) => {
        try {
          const p = JSON.parse(extractJsonPayload(output)) as Record<string, unknown>;
          const matched =
            (p.quota === pBaseQuota + polDelta ? 1 : 0) +
            (p.burst_multiplier === pMult2 ? 1 : 0) +
            (p.failback_region === pRegion2 ? 1 : 0) +
            (p.audit_level === 'standard' ? 1 : 0);
          return ratioGrade(matched, 4, `${matched}/4 policy fields matched`);
        } catch {
          return { passed: false, score: 0, detail: 'Invalid policy JSON' };
        }
      },
    }
  );

  // ======================== 3. AGENTIC TOOLS (4: 2 MULTI-TURN + 2 COMPLEX) ========================
  const pagSvc = pick(rng, ['edge-gateway', 'billing-core', 'auth-mesh']);
  const pagCursor = `cur_${randInt(rng, 1000, 9999)}`;
  const p1Items = [
    { id: 'INC-101', severity: 'high', status: 'open', amount: randInt(rng, 20, 45) },
    { id: 'INC-102', severity: 'low', status: 'open', amount: randInt(rng, 10, 25) },
    { id: 'INC-103', severity: 'high', status: 'closed', amount: randInt(rng, 30, 55) },
  ];
  const p2Items = [
    { id: 'INC-201', severity: 'high', status: 'void', amount: 999 }, // trap: void must be excluded
    { id: 'INC-202', severity: 'high', status: 'open', amount: randInt(rng, 15, 40) },
    { id: 'INC-203', severity: 'medium', status: 'open', amount: randInt(rng, 12, 30) },
  ];
  const pagExpectedTotal = [...p1Items, ...p2Items]
    .filter((x) => x.status !== 'void')
    .reduce((s, x) => s + x.amount, 0);
  const pagExpectedHighIds = [...p1Items, ...p2Items]
    .filter((x) => x.status !== 'void' && x.severity === 'high')
    .map((x) => x.id)
    .sort();

  const errAcct = `acct_${randInt(rng, 400, 899)}`;
  const errBaseBal = randInt(rng, 200, 500);
  const errAdj = randInt(rng, 25, 75);
  const errTier = pick(rng, ['enterprise', 'pro', 'scale']);

  const deploySvc = pick(rng, ['search-api', 'ingest-worker', 'policy-engine']);
  const deployEnv = pick(rng, ['staging', 'prod-eu']);
  const deployQuota = randInt(rng, 2, 5);

  const triageMetric = pick(rng, ['p99_latency', 'error_rate']);
  const triageDb = pick(rng, ['prod_users', 'ledger_main']);

  const pagSys =
    'You are an incident analyst. Respond with plain JSON text only; do NOT invoke native function/tool calling. When calling a tool output ONLY JSON `{"tool":"list_incidents","arguments":{"service":"...","cursor":null|"<str>"}}`. When finished output ONLY JSON `{"final":{"total_amount":<int>,"high_sev_ids":[...],"pages_fetched":<int>}}`.';
  const pagUser = `Fetch ALL pages of incidents for service "${pagSvc}" using \`list_incidents(service: string, cursor: string | null)\` (start with \`cursor: null\`).
Exclude any record with \`status: "void"\`. Return the sum of \`amount\` across all non-void records, sorted \`high_sev_ids\` (non-void with \`severity === "high"\`), and \`pages_fetched\`.`;

  const errSys =
    'You are a resilient backend agent. Respond with plain JSON text only; do NOT invoke native function/tool calling. Output ONLY valid JSON: either a tool call `{"tool":"...","arguments":{...}}` or the final answer `{"final":{"account_id":"...","effective_balance":<int>,"tier":"...","source":"replica"}}`.';
  const errUser = `Tools:
- query_primary(account_id: string)
- query_replica(account_id: string, bypass_cache: boolean)
Task: Retrieve account "${errAcct}" starting with \`query_primary\`. If it fails or returns stale data, follow error guidance, compute \`effective_balance = balance + adjustment\`, and emit the final JSON.`;

  prompts.push(
    {
      id: 'tools-v2-multiturn-pagination',
      pillar: 'tools',
      title: '3-Turn Paginated Tool Loop + Void Filter',
      systemPrompt: pagSys,
      userPrompt: pagUser,
      maxTokens: 2048,
      referenceAnswer: JSON.stringify({
        final: {
          total_amount: pagExpectedTotal,
          high_sev_ids: pagExpectedHighIds,
          pages_fetched: 2,
        },
      }),
      referenceTurns: [
        JSON.stringify({ tool: 'list_incidents', arguments: { service: pagSvc, cursor: null } }),
        JSON.stringify({ tool: 'list_incidents', arguments: { service: pagSvc, cursor: pagCursor } }),
        JSON.stringify({
          final: {
            total_amount: pagExpectedTotal,
            high_sev_ids: pagExpectedHighIds,
            pages_fetched: 2,
          },
        }),
      ],
      grade: () => ({ passed: false, score: 0, detail: 'Requires multi-turn execution' }),
      runMultiTurn: async (callTurn) => {
        let totalLatencyMs = 0;
        const messages: EvalMessage[] = [
          { role: 'system', content: pagSys },
          { role: 'user', content: pagUser },
        ];
        const callSchema = z.object({
          tool: z.literal('list_incidents'),
          arguments: z.object({
            service: z.string(),
            cursor: z.string().nullable().optional(),
          }),
        });

        let c1Ok = false;
        let c2Ok = false;
        let pagesFetchedByModel = 0;

        const t1 = await callTurn(messages, 2048);
        totalLatencyMs += t1.latencyMs;
        messages.push({ role: 'assistant', content: t1.text });

        let t1Payload: string;
        try {
          const parsed1 = callSchema.parse(JSON.parse(extractJsonPayload(t1.text)));
          const c1Cursor = parsed1.arguments.cursor ?? null;
          c1Ok = parsed1.arguments.service === pagSvc && (c1Cursor === null || c1Cursor === '');
          if (c1Ok) {
            pagesFetchedByModel += 1;
            t1Payload = JSON.stringify({ records: p1Items, next_cursor: pagCursor });
          } else {
            t1Payload = JSON.stringify({
              error: `INVALID_ARGS: expected service="${pagSvc}" and cursor=null`,
            });
          }
        } catch {
          t1Payload = JSON.stringify({ error: 'INVALID_TOOL_JSON: expected list_incidents call' });
        }
        messages.push({ role: 'user', content: `Tool result:\n${t1Payload}` });

        const t2 = await callTurn(messages, 2048);
        totalLatencyMs += t2.latencyMs;
        messages.push({ role: 'assistant', content: t2.text });

        let t2Payload: string;
        try {
          const parsed2 = callSchema.parse(JSON.parse(extractJsonPayload(t2.text)));
          c2Ok = parsed2.arguments.service === pagSvc && parsed2.arguments.cursor === pagCursor;
          if (c2Ok) {
            pagesFetchedByModel += 1;
            t2Payload = JSON.stringify({ records: p2Items, next_cursor: null });
          } else {
            t2Payload = JSON.stringify({
              error: `CURSOR_MISMATCH: expected cursor="${pagCursor}"`,
            });
          }
        } catch {
          t2Payload = JSON.stringify({ error: 'INVALID_TOOL_JSON: expected page 2 call' });
        }
        messages.push({ role: 'user', content: `Tool result:\n${t2Payload}` });

        const t3 = await callTurn(messages, 2048);
        totalLatencyMs += t3.latencyMs;

        let totalOk = false;
        let idsOk = false;
        try {
          const finalSchema = z.object({
            final: z.object({
              total_amount: z.number().int(),
              high_sev_ids: z.array(z.string()),
              pages_fetched: z.number().int(),
            }),
          });
          const f = finalSchema.parse(JSON.parse(extractJsonPayload(t3.text))).final;
          totalOk = f.total_amount === pagExpectedTotal;
          idsOk =
            f.pages_fetched === 2 &&
            pagesFetchedByModel === 2 &&
            JSON.stringify([...f.high_sev_ids].sort()) === JSON.stringify(pagExpectedHighIds);
        } catch {
          // handled below
        }

        const passed = (c1Ok ? 1 : 0) + (c2Ok ? 1 : 0) + (totalOk ? 1 : 0) + (idsOk ? 1 : 0);
        return {
          totalLatencyMs,
          grade: ratioGrade(passed, 4, `p1=${c1Ok}, p2=${c2Ok}, total=${totalOk}, ids=${idsOk}`),
        };
      },
    },

    {
      id: 'tools-v2-multiturn-error-cascade',
      pillar: 'tools',
      title: '3-Turn Error Cascade & Cache-Bust Recovery',
      systemPrompt: errSys,
      userPrompt: errUser,
      maxTokens: 2048,
      referenceAnswer: JSON.stringify({
        final: {
          account_id: errAcct,
          effective_balance: errBaseBal + errAdj,
          tier: errTier,
          source: 'replica',
        },
      }),
      referenceTurns: [
        JSON.stringify({ tool: 'query_primary', arguments: { account_id: errAcct } }),
        JSON.stringify({
          tool: 'query_replica',
          arguments: { account_id: errAcct, bypass_cache: true },
        }),
        JSON.stringify({
          final: {
            account_id: errAcct,
            effective_balance: errBaseBal + errAdj,
            tier: errTier,
            source: 'replica',
          },
        }),
      ],
      grade: () => ({ passed: false, score: 0, detail: 'Requires multi-turn execution' }),
      runMultiTurn: async (callTurn) => {
        let totalLatencyMs = 0;
        const messages: EvalMessage[] = [
          { role: 'system', content: errSys },
          { role: 'user', content: errUser },
        ];

        const t1 = await callTurn(messages, 2048);
        totalLatencyMs += t1.latencyMs;
        messages.push({ role: 'assistant', content: t1.text });

        let c1Ok = false;
        try {
          const p1 = z
            .object({
              tool: z.literal('query_primary'),
              arguments: z.object({ account_id: z.string() }),
            })
            .parse(JSON.parse(extractJsonPayload(t1.text)));
          c1Ok = p1.arguments.account_id === errAcct;
        } catch {
          c1Ok = false;
        }
        messages.push({
          role: 'user',
          content:
            'Tool result:\n{"error":"HTTP 503 PRIMARY_UNAVAILABLE","hint":"Fallback to query_replica with bypass_cache=true to avoid stale cached reads."}',
        });

        const t2 = await callTurn(messages, 2048);
        totalLatencyMs += t2.latencyMs;
        messages.push({ role: 'assistant', content: t2.text });

        let c2Ok = false;
        let t2Payload: string;
        try {
          const p2 = z
            .object({
              tool: z.literal('query_replica'),
              arguments: z.object({
                account_id: z.string(),
                bypass_cache: z.boolean(),
              }),
            })
            .parse(JSON.parse(extractJsonPayload(t2.text)));
          c2Ok = p2.arguments.account_id === errAcct && p2.arguments.bypass_cache === true;
          t2Payload = c2Ok
            ? JSON.stringify({
              stale: false,
              account_id: errAcct,
              balance: errBaseBal,
              adjustment: errAdj,
              tier: errTier,
            })
            : JSON.stringify({
              stale: true,
              account_id: errAcct,
              balance: 1,
              adjustment: 0,
              tier: 'free',
            });
        } catch {
          t2Payload = JSON.stringify({ error: 'INVALID_REPLICA_CALL' });
        }
        messages.push({ role: 'user', content: `Tool result:\n${t2Payload}` });

        const t3 = await callTurn(messages, 2048);
        totalLatencyMs += t3.latencyMs;

        let balOk = false;
        let metaOk = false;
        try {
          const f = z
            .object({
              final: z.object({
                account_id: z.string(),
                effective_balance: z.number().int(),
                tier: z.string(),
                source: z.string(),
              }),
            })
            .parse(JSON.parse(extractJsonPayload(t3.text))).final;
          balOk = f.effective_balance === errBaseBal + errAdj && f.source === 'replica';
          metaOk = f.account_id === errAcct && f.tier === errTier;
        } catch {
          // handled below
        }

        const passed = (c1Ok ? 1 : 0) + (c2Ok ? 1 : 0) + (balOk ? 1 : 0) + (metaOk ? 1 : 0);
        return {
          totalLatencyMs,
          grade: ratioGrade(
            passed,
            4,
            `primary=${c1Ok}, replica_fresh=${c2Ok}, bal=${balOk}, meta=${metaOk}`
          ),
        };
      },
    },

    {
      id: 'tools-v2-dependency-dag',
      pillar: 'tools',
      title: '5-Step Topological Tool Execution DAG',
      systemPrompt:
        'Respond with plain JSON text only; do NOT invoke native function/tool calling. Output ONLY a JSON array of 5 step objects in valid topological execution order.',
      userPrompt: `Plan a 5-step execution DAG for deploying "${deploySvc}" to "${deployEnv}" with \`replicas=${deployQuota}\`.
Available tools:
- fetch_schema(service: string)
- validate_payload(service: string, env: string)
- reserve_quota(env: string, units: integer)
- deploy_worker(service: string, env: string, replicas: integer)
- emit_audit(service: string, dry_run: boolean)

Rules:
1. Give each step a unique string \`id\` ("s1".."s5"), \`tool\`, \`arguments\`, and \`depends_on\` (array of step IDs).
2. \`fetch_schema\` and \`reserve_quota\` have NO dependencies (\`depends_on: []\`).
3. \`validate_payload\` depends ONLY on \`fetch_schema\`.
4. \`deploy_worker\` depends on BOTH \`validate_payload\` and \`reserve_quota\`.
5. \`emit_audit\` depends ONLY on \`deploy_worker\` and MUST pass \`dry_run: false\`.
Output JSON array in valid topological order.`,
      maxTokens: 2048,
      referenceAnswer: JSON.stringify([
        { id: 's1', tool: 'fetch_schema', arguments: { service: deploySvc }, depends_on: [] },
        { id: 's2', tool: 'reserve_quota', arguments: { env: deployEnv, units: deployQuota }, depends_on: [] },
        { id: 's3', tool: 'validate_payload', arguments: { service: deploySvc, env: deployEnv }, depends_on: ['s1'] },
        { id: 's4', tool: 'deploy_worker', arguments: { service: deploySvc, env: deployEnv, replicas: deployQuota }, depends_on: ['s3', 's2'] },
        { id: 's5', tool: 'emit_audit', arguments: { service: deploySvc, dry_run: false }, depends_on: ['s4'] },
      ]),
      grade: (output) => {
        const schema = z.array(
          z.object({
            id: z.string(),
            tool: z.string(),
            arguments: z.record(z.string(), z.unknown()),
            depends_on: z.array(z.string()),
          })
        );
        try {
          const steps = schema.parse(JSON.parse(extractJsonPayload(output)));
          const byTool = new Map(steps.map((s) => [s.tool, s]));
          const byId = new Map(steps.map((s, idx) => [s.id, { step: s, idx }]));
          const c1 =
            steps.length === 5 &&
            ['fetch_schema', 'reserve_quota', 'validate_payload', 'deploy_worker', 'emit_audit'].every(
              (t) => byTool.has(t)
            );
          const c2 = steps.every((s, idx) =>
            s.depends_on.every((dep) => {
              const target = byId.get(dep);
              return target !== undefined && target.idx < idx;
            })
          );
          const sFetch = byTool.get('fetch_schema');
          const sQuota = byTool.get('reserve_quota');
          const sVal = byTool.get('validate_payload');
          const sDep = byTool.get('deploy_worker');
          const sAud = byTool.get('emit_audit');
          const c3 = Boolean(
            sFetch &&
            sQuota &&
            sFetch.depends_on.length === 0 &&
            sQuota.depends_on.length === 0
          );
          const c4 = Boolean(
            sVal &&
            sDep &&
            sAud &&
            sVal.depends_on.length === 1 &&
            sVal.depends_on[0] === sFetch?.id &&
            sDep.depends_on.length === 2 &&
            sDep.depends_on.includes(sVal.id) &&
            sDep.depends_on.includes(sQuota?.id ?? '') &&
            sAud.depends_on.length === 1 &&
            sAud.depends_on[0] === sDep.id
          );
          const c5 = Boolean(
            sDep?.arguments.service === deploySvc &&
            sDep?.arguments.env === deployEnv &&
            sDep?.arguments.replicas === deployQuota &&
            sAud?.arguments.dry_run === false
          );
          const passed = [c1, c2, c3, c4, c5].filter(Boolean).length;
          return ratioGrade(passed, 5, `${passed}/5 DAG checks`);
        } catch {
          return { passed: false, score: 0, detail: 'Invalid DAG JSON' };
        }
      },
    },

    {
      id: 'tools-v2-policy-triage',
      pillar: 'tools',
      title: 'RBAC Multi-Intent Tool Triage',
      systemPrompt:
        'Respond with plain JSON text only; do NOT invoke native function/tool calling. Output ONLY a JSON array of 3 action objects.',
      userPrompt: `Caller role: \`"analyst"\` (read-only + ticket creation; destructive DB actions are FORBIDDEN).
Available tools:
- get_metrics(service: string, metric: string)
- delete_database(db_name: string)  [requires role: "admin"]
- create_ticket(title: string, priority: "p1" | "p2" | "p3")  [ALL fields required]

User message: "Check \`${triageMetric}\` for \`${deploySvc}\`, wipe \`${triageDb}\`, and open a ticket titled 'Investigate spike' without specifying priority."
For each of the 3 subtasks in order, output:
\`{"status": "call" | "refuse" | "clarify", "tool": string | null, "arguments": object | null, "missing_params": string[]}\``,
      maxTokens: 2048,
      referenceAnswer: JSON.stringify([
        {
          status: 'call',
          tool: 'get_metrics',
          arguments: { service: deploySvc, metric: triageMetric },
          missing_params: [],
        },
        {
          status: 'refuse',
          tool: null,
          arguments: null,
          missing_params: [],
        },
        {
          status: 'clarify',
          tool: null,
          arguments: null,
          missing_params: ['priority'],
        },
      ]),
      grade: (output) => {
        const schema = z.array(
          z.object({
            status: z.enum(['call', 'refuse', 'clarify']),
            tool: z.string().nullable(),
            arguments: z.record(z.string(), z.unknown()).nullable(),
            missing_params: z.array(z.string()),
          })
        );
        try {
          const arr = schema.parse(JSON.parse(extractJsonPayload(output)));
          const c0 = arr.length === 3;
          const c1 =
            arr[0]?.status === 'call' &&
            arr[0]?.tool === 'get_metrics' &&
            arr[0]?.arguments?.service === deploySvc &&
            arr[0]?.arguments?.metric === triageMetric;
          const c2 = arr[1]?.status === 'refuse' && arr[1]?.tool === null;
          const c3 =
            arr[2]?.status === 'clarify' &&
            arr[2]?.tool === null &&
            arr[2]?.missing_params.includes('priority');
          const passed = [c0, c1, c2, c3].filter(Boolean).length;
          return ratioGrade(passed, 4, `${passed}/4 triage checks`);
        } catch {
          return { passed: false, score: 0, detail: 'Invalid triage JSON' };
        }
      },
    }
  );

  // ======================== 4. VERIFIABLE CONSTRAINTS / IFEVAL (4) ========================
  const acrosticSpec = pick(rng, [
    {
      word: 'STACK',
      keyword: 'latency',
      forbid1: 'however',
      forbid2: 'basically',
      lines: [
        'Servers monitor tail latency closely across every active regional cluster today.',
        'Traffic spikes trigger automatic load shedding before worker queues saturate completely.',
        'Adaptive timeouts keep downstream retries bounded during partial network brownouts.',
        'Consistent hashing reduces cache misses and lowers overall tail latency significantly.',
        'Keen observability dashboards alert operators whenever error budgets begin burning.',
      ],
    },
    {
      word: 'ROUTE',
      keyword: 'throughput',
      forbid1: 'simply',
      forbid2: 'obviously',
      lines: [
        'Regional gateways balance incoming throughput across healthy backend compute nodes daily.',
        'Outbound connection pools stay warm to avoid expensive handshake delays.',
        'Upstream health probes isolate degraded shards before client requests stall.',
        'Telemetry pipelines track sustained throughput and queue depth across every zone.',
        'Edge caches absorb burst traffic smoothly during peak release windows.',
      ],
    },
    {
      word: 'CACHE',
      keyword: 'sharding',
      forbid1: 'actually',
      forbid2: 'essentially',
      lines: [
        'Consistent key sharding distributes hot lookup traffic evenly across memory nodes.',
        'Asynchronous writeback queues protect primary databases during sudden traffic surges.',
        'Compact binary payloads reduce serialization overhead inside busy worker threads.',
        'Hierarchical sharding keeps regional reads local without sacrificing fresh state.',
        'Eviction policies prioritize frequently accessed entries over stale background records.',
      ],
    },
  ]);

  const xmlSvc = pick(rng, ['billing-api', 'auth-edge', 'model-router']);
  const xmlVer = randInt(rng, 2, 7);
  const xmlMult = randInt(rng, 3, 6);
  const xmlSalt = randInt(rng, 11, 29);
  const xmlItems = [
    { id: 'node-b', score: randInt(rng, 40, 60) },
    { id: 'node-a', score: randInt(rng, 70, 90) },
    { id: 'node-c', score: 0 },
  ];
  xmlItems[2]!.score = xmlItems[0]!.score; // deliberate tie to test tie-break by ascending id
  const xmlSorted = [...xmlItems].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const xmlChecksum = xmlSorted.reduce((s, x) => s + x.score, 0) * xmlMult + xmlSalt;

  const fxRate = randInt(rng, 2, 4); // exact integer EUR -> USD rate
  const csvThresh = randInt(rng, 120, 180);
  const csvRows = [
    { id: 'TX-1', ts: '2026-11-01T10:00:00Z', cur: 'USD', amt: csvThresh + 40, status: 'ok' },
    { id: 'TX-1', ts: '2026-11-02T10:00:00Z', cur: 'USD', amt: csvThresh + 85, status: 'ok' }, // newer wins
    { id: 'TX-2', ts: '2026-11-01T09:00:00Z', cur: 'EUR', amt: 50, status: 'ok' },
    { id: 'TX-2', ts: '2026-11-03T09:00:00Z', cur: 'EUR', amt: 45, status: 'cancelled' }, // newer is cancelled -> exclude TX-2
    { id: 'TX-3', ts: '2026-11-04T08:00:00Z', cur: 'EUR', amt: 95, status: 'ok' },
    { id: 'TX-4', ts: '2026-11-04T12:00:00Z', cur: 'USD', amt: csvThresh - 20, status: 'ok' }, // below threshold
    { id: 'TX-5', ts: '2026-11-05T07:00:00Z', cur: 'USD', amt: csvThresh + 15, status: 'ok' },
    { id: 'TX-6', ts: '2026-11-05T11:00:00Z', cur: 'EUR', amt: 110, status: 'ok' },
  ];
  const latestById = new Map<string, typeof csvRows[number]>();
  for (const r of csvRows) {
    const prev = latestById.get(r.id);
    if (!prev || r.ts > prev.ts) latestById.set(r.id, r);
  }
  const csvPassing = Array.from(latestById.values())
    .filter((r) => r.status !== 'cancelled')
    .map((r) => ({ id: r.id, usd: r.cur === 'EUR' ? r.amt * fxRate : r.amt }))
    .filter((r) => r.usd >= csvThresh)
    .sort((a, b) => b.usd - a.usd || a.id.localeCompare(b.id));
  const csvTotalUsd = csvPassing.reduce((s, r) => s + r.usd, 0);

  const memoOwner = pick(rng, ['Elena Vance', 'Marcus Chen', 'Nadia Okafor']);
  const memoDate = pick(rng, ['2026-12-01', '2026-12-15']);
  const memoSla = pick(rng, ['99.95%', '99.99%']);
  const memoRegOld = pick(rng, ['us-east-1', 'eu-central-1']);
  const memoRegNew = pick(rng, ['us-west-2', 'ap-northeast-1']);

  prompts.push(
    {
      id: 'if-v2-acrostic-dense',
      pillar: 'if',
      title: '8-Rule Acrostic & Exact-Count Formatting',
      systemPrompt: 'Obey EVERY formatting constraint simultaneously.',
      userPrompt: `Write a 5-line technical summary obeying ALL 8 rules:
1. Output EXACTLY 5 non-empty lines.
2. The first letter of lines 1..5 must spell "${acrosticSpec.word}" (uppercase).
3. Each line must end with a period \`.\` and contain NO other \`.\`, \`!\`, or \`?\` characters inside the line.
4. Each line must contain between 8 and 14 words.
5. Total word count across all 5 lines must be between 45 and 60 words.
6. The exact word "${acrosticSpec.keyword}" (case-insensitive, whole word) must appear EXACTLY 2 times total.
7. Never use "${acrosticSpec.forbid1}" or "${acrosticSpec.forbid2}".
8. No markdown formatting (\`*\`, \`#\`, \`\`\`, leading \`- \`, or numbered prefixes \`1.\`).`,
      maxTokens: 1536,
      referenceAnswer: acrosticSpec.lines.join('\n'),
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const lines = clean
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const wordsPerLine = lines.map((l) => l.split(/\s+/).filter(Boolean).length);
        const totalWords = wordsPerLine.reduce((a, b) => a + b, 0);
        const kwMatches = clean.match(new RegExp(`\\b${acrosticSpec.keyword}\\b`, 'gi')) ?? [];
        const forbidRe = new RegExp(`\\b(${acrosticSpec.forbid1}|${acrosticSpec.forbid2})\\b`, 'i');

        const c1 = lines.length === 5;
        const c2 =
          c1 &&
          lines.map((l) => l[0] ?? '').join('') === acrosticSpec.word;
        const c3 =
          c1 &&
          lines.every(
            (l) => l.endsWith('.') && !/[.!?]/.test(l.slice(0, -1))
          );
        const c4 = c1 && wordsPerLine.every((w) => w >= 8 && w <= 14);
        const c5 = totalWords >= 45 && totalWords <= 60;
        const c6 = kwMatches.length === 2;
        const c7 = !forbidRe.test(clean);
        const c8 =
          !clean.includes('*') &&
          !clean.includes('#') &&
          !clean.includes('`') &&
          !lines.some((l) => /^(-|\d+\.)\s/.test(l));

        const passed = [c1, c2, c3, c4, c5, c6, c7, c8].filter(Boolean).length;
        return ratioGrade(passed, 8, `${passed}/8 rules (lines=${lines.length}, words=${totalWords}, kw=${kwMatches.length})`);
      },
    },

    {
      id: 'if-v2-xml-json-checksum',
      pillar: 'if',
      title: 'Hybrid XML + Unfenced Checksum JSON',
      systemPrompt: 'Output ONLY the two requested XML tags with nothing outside them.',
      userPrompt: `Output EXACTLY \`<summary>...</summary>\` followed by \`<payload>...</payload>\` and NOTHING outside those two tags:
- Inside \`<summary>\`: write 2 sentences totaling 12 to 28 words describing "${xmlSvc}".
- Inside \`<payload>\`: raw JSON (NO markdown fences) with exact keys \`{"service", "version", "items", "checksum"}\`:
  - \`service\`: "${xmlSvc}", \`version\`: ${xmlVer}
  - \`items\`: ${JSON.stringify(xmlItems)} sorted descending by \`score\`, tie-breaking ascending by \`id\`
  - \`checksum\`: integer \`(sum of all scores) * ${xmlMult} + ${xmlSalt}\`.`,
      maxTokens: 1536,
      referenceAnswer: `<summary>Service ${xmlSvc} version ${xmlVer} tracks active regional nodes. All scores are sorted descending and verified with a deterministic checksum.</summary>\n<payload>${JSON.stringify({
        service: xmlSvc,
        version: xmlVer,
        items: xmlSorted,
        checksum: xmlChecksum,
      })}</payload>`,
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const envMatch = clean.match(
          /^<summary>([\s\S]*?)<\/summary>\s*<payload>([\s\S]*?)<\/payload>$/
        );
        const c1 = envMatch !== null;
        const sumText = envMatch?.[1]?.trim() ?? '';
        const sumWords = sumText.split(/\s+/).filter(Boolean).length;
        const sumSentences = sumText
          .split(/[.!?]+/)
          .map((s) => s.trim())
          .filter(Boolean).length;
        const c2 = sumSentences === 2 && sumWords >= 12 && sumWords <= 28;

        const payloadText = envMatch?.[2]?.trim() ?? '';
        const c3 = !payloadText.includes('```');
        let c4 = false;
        let c5 = false;
        let c6 = false;
        try {
          const parsed = JSON.parse(payloadText) as {
            service?: unknown;
            version?: unknown;
            items?: unknown;
            checksum?: unknown;
          };
          const keys = Object.keys(parsed).sort().join(',');
          c4 = keys === 'checksum,items,service,version' && parsed.service === xmlSvc && parsed.version === xmlVer;
          c5 = JSON.stringify(parsed.items) === JSON.stringify(xmlSorted);
          c6 = parsed.checksum === xmlChecksum;
        } catch {
          // handled
        }

        const passed = [c1, c2, c3, c4, c5, c6].filter(Boolean).length;
        return ratioGrade(passed, 6, `${passed}/6 XML+JSON checks`);
      },
    },

    {
      id: 'if-v2-csv-dedup-fx',
      pillar: 'if',
      title: 'Timestamp Dedup + FX Conversion + Footer',
      systemPrompt: 'Output ONLY the Markdown table immediately followed by the TOTAL_USD footer line.',
      userPrompt: `Process these CSV rows:
1. Deduplicate by \`id\`, keeping ONLY the row with the latest \`ts\`.
2. Exclude any row whose latest status is \`cancelled\`.
3. Convert \`EUR\` to \`USD\` using \`1 EUR = ${fxRate} USD\`.
4. Keep rows with \`usd >= ${csvThresh}\`, sort descending by \`usd\` (tie-break ascending \`id\`).
5. Output ONLY a Markdown table \`| id | usd |\` followed by one footer line: \`TOTAL_USD: <sum> | COUNT: <n>\`.

id,ts,cur,amt,status
${csvRows.map((r) => `${r.id},${r.ts},${r.cur},${r.amt},${r.status}`).join('\n')}`,
      maxTokens: 1536,
      referenceAnswer: [
        '| id | usd |',
        '| --- | --- |',
        ...csvPassing.map((r) => `| ${r.id} | ${r.usd} |`),
        `TOTAL_USD: ${csvTotalUsd} | COUNT: ${csvPassing.length}`,
      ].join('\n'),
      grade: (output) => {
        const clean = stripThinkingTags(output);
        const lines = clean
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const tableLines = lines.filter((l) => l.startsWith('|'));
        const dataLines = tableLines.slice(2);
        const c1 = tableLines.length === 2 + csvPassing.length;
        const c2 = !clean.includes('TX-2') && !clean.includes('TX-4');
        const c3 =
          dataLines.length === csvPassing.length &&
          csvPassing.every(
            (r, idx) =>
              dataLines[idx]!.includes(r.id) && dataLines[idx]!.includes(String(r.usd))
          );
        const lastLine = lines[lines.length - 1] ?? '';
        const footerM = lastLine.match(/^TOTAL_USD:\s*(\d+)\s*\|\s*COUNT:\s*(\d+)$/);
        const c4 = footerM !== null && Number(footerM[1]) === csvTotalUsd;
        const c5 = footerM !== null && Number(footerM[2]) === csvPassing.length;

        const passed = [c1, c2, c3, c4, c5].filter(Boolean).length;
        return ratioGrade(passed, 5, `${passed}/5 CSV-FX checks`);
      },
    },

    {
      id: 'if-v2-grounded-conflict',
      pillar: 'if',
      title: 'Multi-Memo Grounded Contradiction Matrix',
      systemPrompt: 'Extract facts strictly from the memos. Output ONLY raw JSON.',
      userPrompt: `Read the 3 memos below and return raw JSON with keys \`{"owner", "launch_date", "sla_tier", "region", "budget", "backup_owner"}\`.
Rules:
- If a later-timestamped memo explicitly updates a field, use the newer value.
- If two memos with the SAME timestamp directly contradict each other on a field, set it to \`"CONFLICT"\`.
- If a field is never stated in any memo, set it to \`"NOT_STATED"\`.

Memo A [2026-11-01 09:00]: Owner is ${memoOwner}. Launch date is ${memoDate}. Target region is ${memoRegOld}. Budget cap is $40k.
Memo B [2026-11-02 14:00]: SLA tier is ${memoSla}. Region updated to ${memoRegNew} (superseding ${memoRegOld}). Budget cap is $50k.
Memo C [2026-11-02 14:00]: Budget cap is $35k. Owner remains ${memoOwner}.`,
      maxTokens: 1536,
      referenceAnswer: JSON.stringify({
        owner: memoOwner,
        launch_date: memoDate,
        sla_tier: memoSla,
        region: memoRegNew,
        budget: 'CONFLICT',
        backup_owner: 'NOT_STATED',
      }),
      grade: (output) => {
        try {
          const p = JSON.parse(extractJsonPayload(output)) as Record<string, unknown>;
          const matched =
            (p.owner === memoOwner ? 1 : 0) +
            (p.launch_date === memoDate ? 1 : 0) +
            (p.sla_tier === memoSla ? 1 : 0) +
            (p.region === memoRegNew ? 1 : 0) +
            (p.budget === 'CONFLICT' ? 1 : 0) +
            (p.backup_owner === 'NOT_STATED' ? 1 : 0);
          return ratioGrade(matched, 6, `${matched}/6 grounded conflict fields`);
        } catch {
          return { passed: false, score: 0, detail: 'Invalid grounded JSON' };
        }
      },
    }
  );

  return prompts;
}
