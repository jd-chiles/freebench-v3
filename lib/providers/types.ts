import { z } from 'zod';
import providersRaw from '@/config/providers.json';
import type { AccessMode, FreeTierType, ProviderSlug } from '@/lib/supabase/types';

export type { AccessMode, FreeTierType, ProviderSlug };

export interface DiscoveredFreeModel {
  provider_slug: ProviderSlug;
  provider_model_id: string;
  raw_display_name?: string;
  context_window: number | null;
  supports_tools: boolean | null;
  supports_vision: boolean | null;
  rpm_limit: string;
  rpd_limit: string;
  tier_type: FreeTierType;
  trains_on_data: boolean;
  requires_credit_card: boolean;
  signup_url: string;
  zdr_available?: boolean;
}

export interface ProviderPollResult {
  provider_slug: ProviderSlug;
  ok: boolean;
  skipped?: boolean;
  models: DiscoveredFreeModel[];
  error?: string;
  duration_ms: number;
}

export const ModelLimitOverrideSchema = z.object({
  rpm_int: z.number().int().nonnegative().nullable().optional(),
  rpd_int: z.number().int().nonnegative().nullable().optional(),
  tpm_int: z.number().int().nonnegative().nullable().optional(),
  tpd_int: z.number().int().nonnegative().nullable().optional(),
  rpm_limit: z.string().optional(),
  rpd_limit: z.string().optional(),
});

export type ModelLimitOverride = z.infer<typeof ModelLimitOverrideSchema>;

export const ProviderStaticConfigSchema = z.object({
  display_name: z.string(),
  access_mode: z.enum(['direct_api', 'harness_only']).default('direct_api'),
  harness_name: z.string().nullable().optional(),
  tier_type: z.enum(['always_free', 'trial_credit']),
  tier_note: z.string().optional(),
  rpm_limit: z.string(),
  rpd_limit: z.string(),
  rpm_int: z.number().int().nonnegative().nullable().optional(),
  rpd_int: z.number().int().nonnegative().nullable().optional(),
  tpm_int: z.number().int().nonnegative().nullable().optional(),
  tpd_int: z.number().int().nonnegative().nullable().optional(),
  quota_reset_tz: z.string().nullable().optional(),
  quota_reset_label: z.string().optional(),
  model_limit_overrides: z.record(z.string(), ModelLimitOverrideSchema).optional(),
  trains_on_data: z.boolean(),
  privacy_note: z.string().optional(),
  requires_credit_card: z.boolean(),
  signup_url: z.string().url(),
  api_base_url: z.string().url(),
  env_var: z.string(),
  openai_compatible: z.boolean(),
  affiliate_url: z.string().url().nullable().optional(),
  upgrade_url: z.string().url().optional(),
  badge_color: z.string().optional(),
  free_allowlist_prefixes: z.array(z.string()).optional(),
  blocklist_substrings: z.array(z.string()).optional(),
});

export const ProvidersConfigMapSchema = z.object({
  openrouter: ProviderStaticConfigSchema,
  kilo: ProviderStaticConfigSchema,
  opencode: ProviderStaticConfigSchema,
  pollinations: ProviderStaticConfigSchema,
  google: ProviderStaticConfigSchema,
  groq: ProviderStaticConfigSchema,
  cerebras: ProviderStaticConfigSchema,
  nvidia: ProviderStaticConfigSchema,
  cloudflare: ProviderStaticConfigSchema,
  mistral: ProviderStaticConfigSchema,
  sambanova: ProviderStaticConfigSchema,
  cohere: ProviderStaticConfigSchema,
  chutes: ProviderStaticConfigSchema,
  siliconflow: ProviderStaticConfigSchema,
  zai: ProviderStaticConfigSchema,
});

export type ProviderStaticConfig = z.infer<typeof ProviderStaticConfigSchema>;
export type ProvidersConfigMap = z.infer<typeof ProvidersConfigMapSchema>;

let cachedProvidersConfig: ProvidersConfigMap | null = null;

/**
 * Loads and Zod-validates static provider metadata from `config/providers.json`.
 */
export function getProvidersConfig(): ProvidersConfigMap {
  if (!cachedProvidersConfig) {
    cachedProvidersConfig = ProvidersConfigMapSchema.parse(providersRaw);
  }
  return cachedProvidersConfig;
}
