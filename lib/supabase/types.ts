export type ProviderSlug =
  | 'openrouter'
  | 'kilo'
  | 'opencode'
  | 'pollinations'
  | 'google'
  | 'groq'
  | 'cerebras'
  | 'nvidia'
  | 'cloudflare'
  | 'mistral'
  | 'sambanova'
  | 'cohere'
  | 'chutes'
  | 'siliconflow'
  | 'zai';

export type FreeTierType = 'always_free' | 'trial_credit';

export type AccessMode = 'direct_api' | 'harness_only';

export interface ProviderOffering {
  provider_slug: ProviderSlug;
  provider_model_id: string;
  raw_display_name: string | null;
  context_window: number | null;
  supports_tools: boolean | null;
  supports_vision: boolean | null;
  rpm_limit: string;
  rpd_limit: string;
  rpm_int?: number | null;
  rpd_int?: number | null;
  tpm_int?: number | null;
  tpd_int?: number | null;
  quota_reset_tz?: string | null;
  tier_type: FreeTierType;
  trains_on_data: boolean;
  requires_credit_card: boolean;
  signup_url: string;
  zdr_available: boolean;
  last_checked_at: string;
  last_probe_at?: string | null;
  last_probe_ok?: boolean | null;
  ttft_ms?: number | null;
  tokens_per_sec?: number | null;
  uptime_7d?: number | null;
  rate_limit_reports_24h?: number;
}

export interface LeaderboardModel {
  canonical_id: string;
  display_name: string;
  family: string | null;
  parameter_count: string | null;
  context_window: number | null;
  supports_tools: boolean | null;
  supports_vision: boolean | null;
  is_open_weights: boolean | null;
  eci_score: number | null;
  livebench_global: number | null;
  livebench_coding: number | null;
  livebench_reasoning: number | null;
  livebench_math: number | null;
  livebench_if: number | null;
  livebench_data: number | null;
  bfcl_overall: number | null;
  aider_polyglot?: number | null;
  swebench_verified?: number | null;
  freebench_score: number | null;
  agentic_coding_score: number | null;
  benchmark_coverage: number;
  updated_at: string;
  active_provider_count: number;
  providers: ProviderOffering[];
}

export interface SyncErrorLogEntry {
  provider?: string;
  source?: string;
  error: string;
}

export interface SyncRunRecord {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  providers_succeeded: number;
  providers_failed: number;
  models_active: number;
  benchmarks_updated: number;
  pulse_items_added: number;
  error_log: SyncErrorLogEntry[];
}

export interface UnmappedEntityRecord {
  origin_type: 'provider' | 'benchmark';
  source_slug: string;
  raw_id: string;
  suggested_canonical_id: string | null;
  sample_metadata: Record<string, unknown>;
  seen_count: number;
  status: 'pending' | 'mapped' | 'ignored';
  first_seen_at: string;
  last_seen_at: string;
}

export interface AvailabilityEventRecord {
  id: number;
  event_type: 'model_added' | 'model_dropped' | 'new_leader' | 'quota_changed';
  canonical_id: string;
  provider_slug: string | null;
  provider_model_id: string | null;
  freebench_score: number | null;
  headline: string;
  summary_md: string;
  detected_at: string;
  published_channels: string[];
}

export interface PulseItemRecord {
  id?: number;
  source_id: string;
  source_name: string;
  source_handle: string | null;
  source_type: 'kol' | 'agent_release' | 'provider_news' | 'hf_trending' | 'freebench_event';
  category_tags: string[];
  title: string;
  summary: string | null;
  url: string;
  published_at: string;
  fetched_at?: string;
}
