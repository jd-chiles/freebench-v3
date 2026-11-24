import { track } from '@vercel/analytics';

type AnalyticsProperties = Record<string, string | number | boolean>;

/**
 * Emits privacy-safe, cookieless product analytics events in production builds.
 * Safe no-op during SSR and local development.
 */
export function trackEvent(eventName: string, properties?: AnalyticsProperties): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'production') {
    return;
  }

  try {
    track(eventName, properties);
  } catch {
    // Analytics must never interrupt user interactions.
  }
}
