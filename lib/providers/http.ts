import type { ProviderPollResult, ProviderSlug } from './types';

export const DEFAULT_POLL_TIMEOUT_MS = 15_000;

/**
 * Fetches JSON from a remote endpoint with a mandatory AbortController timeout.
 * Throws descriptive errors for non-2xx HTTP responses or network/timeout failures.
 */
export async function fetchJsonWithTimeout<T = unknown>(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    });

    if (!response.ok) {
      const bodyPreview = await response.text().catch(() => '');
      const snippet = bodyPreview.slice(0, 200).replace(/\s+/g, ' ').trim();
      throw new Error(
        `HTTP ${response.status} ${response.statusText}${snippet ? `: ${snippet}` : ''}`
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Fetches plain text (CSV/XML) with a mandatory AbortController timeout.
 */
export async function fetchTextWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS
): Promise<string> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Returns a standard graceful skip result when a required provider API key is unset.
 */
export function missingEnvResult(
  providerSlug: ProviderSlug,
  envVarName: string
): ProviderPollResult {
  return {
    provider_slug: providerSlug,
    ok: false,
    skipped: true,
    models: [],
    error: `Missing env var: ${envVarName}`,
    duration_ms: 0,
  };
}

/**
 * Formats an unknown caught error into a safe string message.
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Detects HTTP 401/403 or explicit auth/key failure phrases in a provider error string.
 */
export function isAuthExpiredError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  return (
    /\bHTTP\s+(401|403)\b/i.test(errorMessage) ||
    /\b(unauthorized|invalid[_ ]api[_ ]key|forbidden|revoked)\b/i.test(errorMessage)
  );
}

/**
 * Prefixes provider auth failures with `[KEY EXPIRED]` so ops alerts and `/status` highlight key rotation needs.
 */
export function tagProviderError(errorMessage: string): string {
  if (errorMessage.startsWith('[KEY EXPIRED]')) {
    return errorMessage;
  }
  return isAuthExpiredError(errorMessage) ? `[KEY EXPIRED] ${errorMessage}` : errorMessage;
}

/**
 * Mandatory safety predicate: never wipe/deactivate existing models on a failed or empty poll.
 */
export function shouldApplyDeactivation(result: ProviderPollResult): boolean {
  return result.ok === true && result.models.length > 0;
}
