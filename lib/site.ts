const DEFAULT_SITE_URL = 'https://freebench.org';

/**
 * Resolves the canonical public site URL without a trailing slash,
 * preferring `SITE_URL`, then `NEXT_PUBLIC_SITE_URL`, then Vercel's production URL.
 */
export function getSiteUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const candidates = [
    env.SITE_URL,
    env.NEXT_PUBLIC_SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
  ];

  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;

    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withScheme);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString().replace(/\/+$/, '');
      }
    } catch {
      continue;
    }
  }

  return DEFAULT_SITE_URL;
}
