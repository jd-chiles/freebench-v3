import vm from 'node:vm';

export interface SandboxTestResult {
  passed: boolean;
  passedTests: number;
  totalTests: number;
  error?: string;
}

/**
 * Strips inline `<think>...</think>` reasoning blocks (including unclosed trailing blocks)
 * so deterministic graders evaluate only the model's final answer.
 */
export function stripThinkingTags(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();
}

/**
 * Extracts JS/TS solution code from Markdown fences (or raw text) and strips ES `export` keywords.
 */
export function extractCodeBlock(raw: string): string {
  const trimmed = stripThinkingTags(raw);
  const typedMatch = trimmed.match(/```(?:js|javascript|ts|typescript)\s*\r?\n([\s\S]*?)```/i);
  const anyFenceMatch = trimmed.match(/```\w*\s*\r?\n([\s\S]*?)```/);
  const body = (typedMatch?.[1] ?? anyFenceMatch?.[1] ?? trimmed).trim();
  return body
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
}

/**
 * Extracts a JSON object or array string from Markdown fences or surrounding prose.
 */
export function extractJsonPayload(raw: string): string {
  const trimmed = stripThinkingTags(raw);
  const fenced = trimmed.match(/```(?:json)?\s*\r?\n([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  let start = -1;
  let openChar = '{';
  let closeChar = '}';

  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj;
  } else if (firstArr !== -1) {
    start = firstArr;
    openChar = '[';
    closeChar = ']';
  }

  if (start === -1) return trimmed;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }

  return trimmed.slice(start);
}

/**
 * Runs candidate JS code + a deterministic test harness inside an isolated Node `vm` context
 * with zero host globals (`process`, `require`, `fs`) and a strict CPU/async timeout.
 */
export async function runSandboxedJsTests(
  candidateCode: string,
  harnessCode: string,
  timeoutMs: number = 1000
): Promise<SandboxTestResult> {
  let passedTests = 0;
  let totalTests = 0;

  const sandboxGlobals = Object.create(null) as Record<string, unknown>;
  Object.assign(sandboxGlobals, {
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    setTimeout: (fn: () => void, ms?: number) => {
      const bounded = Math.min(Math.max(0, Number(ms) || 0), 50);
      return setTimeout(fn, bounded);
    },
    __record: (ok: boolean) => {
      totalTests += 1;
      if (ok) passedTests += 1;
    },
    __deepEqual: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
  });

  const context = vm.createContext(sandboxGlobals);
  const wrapped = `(async () => {\n${candidateCode}\n;\n${harnessCode}\n})()`;

  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const execution = vm.runInContext(wrapped, context, { timeout: timeoutMs }) as Promise<unknown>;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timerHandle = setTimeout(() => {
        reject(new Error(`Async execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await Promise.race([execution, timeoutPromise]);

    return {
      passed: totalTests > 0 && passedTests === totalTests,
      passedTests,
      totalTests,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      passedTests,
      totalTests,
      error: msg,
    };
  } finally {
    if (timerHandle) {
      clearTimeout(timerHandle);
    }
  }
}
