import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';

export const MY_KEYS_STORAGE_KEY = 'freebench:my-keys';

export const KEYLESS_PROVIDERS: readonly ProviderSlug[] = [
  'openrouter',
  'kilo',
  'opencode',
  'pollinations',
];

function getValidProviderSet(): Set<string> {
  return new Set(Object.keys(getProvidersConfig()));
}

/**
 * Loads the user's saved free API keys from localStorage, filtering unknown slugs safely.
 */
export function loadMyKeys(): ProviderSlug[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MY_KEYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid = getValidProviderSet();
    return [...new Set(parsed.filter((item): item is ProviderSlug => typeof item === 'string' && valid.has(item)))];
  } catch {
    return [];
  }
}

/**
 * Persists the user's checked free API keys to localStorage.
 */
export function saveMyKeys(keys: ProviderSlug[]): void {
  if (typeof window === 'undefined') return;
  try {
    const valid = getValidProviderSet();
    const cleaned = [...new Set(keys.filter((k) => valid.has(k)))];
    window.localStorage.setItem(MY_KEYS_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // Ignore storage quota or private-mode access errors.
  }
}
