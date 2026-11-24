import { z } from 'zod';
import paidPricingRaw from '@/config/paid-pricing.json';

export const PaidPricingOptionSchema = z.object({
  provider: z.string(),
  input_per_1m_usd: z.number().nonnegative(),
  output_per_1m_usd: z.number().nonnegative(),
  url: z.string().url(),
  last_verified: z.string(),
});

export type PaidPricingOption = z.infer<typeof PaidPricingOptionSchema>;

const PaidPricingMapSchema = z.record(z.string(), z.array(PaidPricingOptionSchema));

let cachedMap: Record<string, PaidPricingOption[]> | null = null;

function getPaidPricingMap(): Record<string, PaidPricingOption[]> {
  if (!cachedMap) {
    cachedMap = PaidPricingMapSchema.parse(paidPricingRaw);
  }
  return cachedMap;
}

/**
 * Returns paid API escape-hatch options for a canonical model, sorted cheapest blended $/1M first.
 */
export function getPaidEscapeHatch(canonicalId: string): PaidPricingOption[] {
  const options = getPaidPricingMap()[canonicalId] ?? [];
  return [...options].sort((a, b) => {
    const aBlended = a.input_per_1m_usd * 0.75 + a.output_per_1m_usd * 0.25;
    const bBlended = b.input_per_1m_usd * 0.75 + b.output_per_1m_usd * 0.25;
    return aBlended - bBlended;
  });
}

/**
 * Estimates USD cost for a typical 100-turn coding-agent session (500K input + 50K output tokens).
 */
export function estimateAgent100TurnCostUsd(option: PaidPricingOption): number {
  const cost = option.input_per_1m_usd * 0.5 + option.output_per_1m_usd * 0.05;
  return Math.round(cost * 1000) / 1000;
}
