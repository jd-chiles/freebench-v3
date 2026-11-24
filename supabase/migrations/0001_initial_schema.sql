-- FreeBench v2 Initial Schema
-- Designed for Supabase Free Tier (<5MB storage, RLS read-only anon, zero public writes)

create extension if not exists pgcrypto;

-- 1. Canonical Models
create table if not exists public.models (
  canonical_id text primary key,
  display_name text not null,
  family text,
  parameter_count text,
  context_window integer,
  supports_tools boolean,
  supports_vision boolean,
  is_open_weights boolean,
  eci_score numeric(6, 2),
  livebench_global numeric(6, 2),
  livebench_coding numeric(6, 2),
  livebench_reasoning numeric(6, 2),
  livebench_math numeric(6, 2),
  livebench_if numeric(6, 2),
  livebench_data numeric(6, 2),
  bfcl_overall numeric(6, 2),
  aider_polyglot numeric(6, 2),
  swebench_verified numeric(6, 2),
  freebench_score numeric(6, 2),
  agentic_coding_score numeric(6, 2),
  benchmark_coverage smallint not null default 0,
  updated_at timestamptz not null default now()
);

-- 2. Live Provider Availability
create table if not exists public.provider_availability (
  id bigint generated always as identity primary key,
  canonical_id text not null references public.models(canonical_id) on delete cascade,
  provider_slug text not null,
  provider_model_id text not null,
  raw_display_name text,
  context_window integer,
  supports_tools boolean,
  supports_vision boolean,
  rpm_limit text not null,
  rpd_limit text not null,
  rpm_int integer,
  rpd_int integer,
  tpm_int integer,
  tpd_int integer,
  quota_reset_tz text,
  tier_type text not null default 'always_free' check (tier_type in ('always_free', 'trial_credit')),
  trains_on_data boolean not null default false,
  requires_credit_card boolean not null default false,
  signup_url text not null,
  zdr_available boolean not null default false,
  is_available boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  last_probe_at timestamptz,
  last_probe_ok boolean,
  last_probe_status integer,
  ttft_ms integer,
  tokens_per_sec numeric(6, 1),
  uptime_7d numeric(5, 2),
  rate_limit_reports_24h integer not null default 0,
  unique (provider_slug, provider_model_id)
);

-- 3. Granular Benchmark Scores
create table if not exists public.benchmark_scores (
  canonical_id text not null references public.models(canonical_id) on delete cascade,
  source text not null check (source in ('epoch', 'livebench', 'bfcl', 'aider', 'swebench')),
  metric_key text not null,
  score numeric(8, 3) not null,
  release_tag text,
  raw_model_name text not null,
  measured_at timestamptz not null default now(),
  primary key (canonical_id, source, metric_key)
);

-- 4. Unmapped Entities Review Queue
create table if not exists public.unmapped_entities (
  origin_type text not null check (origin_type in ('provider', 'benchmark')),
  source_slug text not null,
  raw_id text not null,
  suggested_canonical_id text,
  sample_metadata jsonb not null default '{}'::jsonb,
  seen_count integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'mapped', 'ignored')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (origin_type, source_slug, raw_id)
);

-- 5. Sync Audit Runs
create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  providers_succeeded integer not null default 0,
  providers_failed integer not null default 0,
  models_active integer not null default 0,
  benchmarks_updated integer not null default 0,
  pulse_items_added integer not null default 0,
  error_log jsonb not null default '[]'::jsonb
);

-- 6. Automated Availability & Rank Events (Changelog / RSS / Webhooks)
create table if not exists public.availability_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('model_added', 'model_dropped', 'new_leader', 'quota_changed')),
  canonical_id text not null references public.models(canonical_id) on delete cascade,
  provider_slug text,
  provider_model_id text,
  freebench_score numeric(6, 2),
  headline text not null,
  summary_md text not null,
  detected_at timestamptz not null default now(),
  published_channels jsonb not null default '[]'::jsonb
);

-- 7. Live Model Pulse & KOL Radar Feed
create table if not exists public.pulse_items (
  id bigint generated always as identity primary key,
  source_id text not null,
  source_name text not null,
  source_handle text,
  source_type text not null check (source_type in ('kol', 'agent_release', 'provider_news', 'hf_trending', 'freebench_event')),
  category_tags text[] not null default '{}',
  title text not null,
  summary text,
  url text not null unique,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now()
);

-- 8. Newsletter Subscribers (Write-only for anon; private read)
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source_path text,
  subscribed_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_provider_availability_canonical_active
  on public.provider_availability (canonical_id, is_available);

create index if not exists idx_provider_availability_provider_active
  on public.provider_availability (provider_slug, is_available);

create index if not exists idx_availability_events_detected_at
  on public.availability_events (detected_at desc);

create index if not exists idx_pulse_items_published_at
  on public.pulse_items (published_at desc);

create index if not exists idx_sync_runs_started_at
  on public.sync_runs (started_at desc);

create index if not exists idx_unmapped_entities_status_seen
  on public.unmapped_entities (status, seen_count desc);

-- Atomic RPC: Upsert canonical model preserving the largest verified context window
create or replace function public.upsert_model_max_context(
  p_canonical_id text,
  p_display_name text,
  p_family text default null,
  p_parameter_count text default null,
  p_context_window integer default null,
  p_supports_tools boolean default null,
  p_supports_vision boolean default null,
  p_is_open_weights boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.models (
    canonical_id,
    display_name,
    family,
    parameter_count,
    context_window,
    supports_tools,
    supports_vision,
    is_open_weights,
    updated_at
  )
  values (
    p_canonical_id,
    p_display_name,
    p_family,
    p_parameter_count,
    p_context_window,
    p_supports_tools,
    p_supports_vision,
    p_is_open_weights,
    now()
  )
  on conflict (canonical_id) do update set
    display_name = coalesce(nullif(excluded.display_name, ''), models.display_name),
    family = coalesce(excluded.family, models.family),
    parameter_count = coalesce(excluded.parameter_count, models.parameter_count),
    context_window = nullif(
      greatest(coalesce(models.context_window, 0), coalesce(excluded.context_window, 0)),
      0
    ),
    supports_tools = case
      when models.supports_tools is true or excluded.supports_tools is true then true
      else coalesce(excluded.supports_tools, models.supports_tools)
    end,
    supports_vision = case
      when models.supports_vision is true or excluded.supports_vision is true then true
      else coalesce(excluded.supports_vision, models.supports_vision)
    end,
    is_open_weights = coalesce(excluded.is_open_weights, models.is_open_weights),
    updated_at = now();
end;
$$;

-- Batch RPC: Upsert canonical models in a single DB round-trip
create or replace function public.upsert_models_batch(p_models jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.models (
    canonical_id,
    display_name,
    family,
    parameter_count,
    context_window,
    supports_tools,
    supports_vision,
    is_open_weights,
    updated_at
  )
  select
    r.canonical_id,
    r.display_name,
    r.family,
    r.parameter_count,
    r.context_window,
    r.supports_tools,
    r.supports_vision,
    r.is_open_weights,
    now()
  from jsonb_to_recordset(p_models) as r(
    canonical_id text,
    display_name text,
    family text,
    parameter_count text,
    context_window integer,
    supports_tools boolean,
    supports_vision boolean,
    is_open_weights boolean
  )
  on conflict (canonical_id) do update set
    display_name = coalesce(nullif(excluded.display_name, ''), models.display_name),
    family = coalesce(excluded.family, models.family),
    parameter_count = coalesce(excluded.parameter_count, models.parameter_count),
    context_window = nullif(
      greatest(coalesce(models.context_window, 0), coalesce(excluded.context_window, 0)),
      0
    ),
    supports_tools = case
      when models.supports_tools is true or excluded.supports_tools is true then true
      else coalesce(excluded.supports_tools, models.supports_tools)
    end,
    supports_vision = case
      when models.supports_vision is true or excluded.supports_vision is true then true
      else coalesce(excluded.supports_vision, models.supports_vision)
    end,
    is_open_weights = coalesce(excluded.is_open_weights, models.is_open_weights),
    updated_at = now();
end;
$$;

-- Batch RPC: Upsert unmapped entities while atomically incrementing seen_count
create or replace function public.upsert_unmapped_entities_batch(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.unmapped_entities (
    origin_type,
    source_slug,
    raw_id,
    suggested_canonical_id,
    sample_metadata,
    seen_count,
    status,
    first_seen_at,
    last_seen_at
  )
  select
    r.origin_type,
    r.source_slug,
    r.raw_id,
    r.suggested_canonical_id,
    coalesce(r.sample_metadata, '{}'::jsonb),
    1,
    'pending',
    now(),
    coalesce(r.last_seen_at, now())
  from jsonb_to_recordset(p_items) as r(
    origin_type text,
    source_slug text,
    raw_id text,
    suggested_canonical_id text,
    sample_metadata jsonb,
    last_seen_at timestamptz
  )
  on conflict (origin_type, source_slug, raw_id) do update set
    suggested_canonical_id = coalesce(excluded.suggested_canonical_id, unmapped_entities.suggested_canonical_id),
    sample_metadata = coalesce(excluded.sample_metadata, unmapped_entities.sample_metadata),
    seen_count = unmapped_entities.seen_count + 1,
    status = case when unmapped_entities.status = 'ignored' then 'ignored' else 'pending' end,
    last_seen_at = coalesce(excluded.last_seen_at, now());
end;
$$;

-- Batch RPC: Bulk update denormalized benchmark pillars & composite scores
create or replace function public.bulk_update_model_scores(p_scores jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.models m
  set
    eci_score = s.eci_score,
    livebench_global = s.livebench_global,
    livebench_coding = s.livebench_coding,
    livebench_reasoning = s.livebench_reasoning,
    livebench_math = s.livebench_math,
    livebench_if = s.livebench_if,
    livebench_data = s.livebench_data,
    bfcl_overall = s.bfcl_overall,
    aider_polyglot = s.aider_polyglot,
    swebench_verified = s.swebench_verified,
    freebench_score = s.freebench_score,
    agentic_coding_score = s.agentic_coding_score,
    benchmark_coverage = coalesce(s.benchmark_coverage, 0),
    updated_at = now()
  from jsonb_to_recordset(p_scores) as s(
    canonical_id text,
    eci_score numeric(6, 2),
    livebench_global numeric(6, 2),
    livebench_coding numeric(6, 2),
    livebench_reasoning numeric(6, 2),
    livebench_math numeric(6, 2),
    livebench_if numeric(6, 2),
    livebench_data numeric(6, 2),
    bfcl_overall numeric(6, 2),
    aider_polyglot numeric(6, 2),
    swebench_verified numeric(6, 2),
    freebench_score numeric(6, 2),
    agentic_coding_score numeric(6, 2),
    benchmark_coverage smallint
  )
  where m.canonical_id = s.canonical_id;
end;
$$;

-- Atomic RPC: Soft-deactivate dropped models strictly for a single provider
create or replace function public.deactivate_stale_provider_models(
  p_provider_slug text,
  p_active_ids text[]
)
returns table (
  canonical_id text,
  provider_model_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.provider_availability pa
  set is_available = false,
      last_checked_at = now()
  where pa.provider_slug = p_provider_slug
    and pa.is_available = true
    and pa.provider_model_id != all(p_active_ids)
  returning pa.canonical_id, pa.provider_model_id;
end;
$$;

-- Read-Optimized Leaderboard View (Aggregates active providers per model)
create or replace view public.v_leaderboard_models as
select
  m.canonical_id,
  m.display_name,
  m.family,
  m.parameter_count,
  m.context_window,
  m.supports_tools,
  m.supports_vision,
  m.is_open_weights,
  m.eci_score,
  m.livebench_global,
  m.livebench_coding,
  m.livebench_reasoning,
  m.livebench_math,
  m.livebench_if,
  m.livebench_data,
  m.bfcl_overall,
  m.aider_polyglot,
  m.swebench_verified,
  m.freebench_score,
  m.agentic_coding_score,
  m.benchmark_coverage,
  m.updated_at,
  count(pa.id) filter (where pa.is_available = true)::integer as active_provider_count,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'provider_slug', pa.provider_slug,
        'provider_model_id', pa.provider_model_id,
        'raw_display_name', pa.raw_display_name,
        'context_window', pa.context_window,
        'supports_tools', pa.supports_tools,
        'supports_vision', pa.supports_vision,
        'rpm_limit', pa.rpm_limit,
        'rpd_limit', pa.rpd_limit,
        'rpm_int', pa.rpm_int,
        'rpd_int', pa.rpd_int,
        'tpm_int', pa.tpm_int,
        'tpd_int', pa.tpd_int,
        'quota_reset_tz', pa.quota_reset_tz,
        'tier_type', pa.tier_type,
        'trains_on_data', pa.trains_on_data,
        'requires_credit_card', pa.requires_credit_card,
        'signup_url', pa.signup_url,
        'zdr_available', pa.zdr_available,
        'last_checked_at', pa.last_checked_at,
        'last_probe_at', pa.last_probe_at,
        'last_probe_ok', pa.last_probe_ok,
        'ttft_ms', pa.ttft_ms,
        'tokens_per_sec', pa.tokens_per_sec,
        'uptime_7d', pa.uptime_7d,
        'rate_limit_reports_24h', pa.rate_limit_reports_24h
      )
      order by (pa.tier_type = 'trial_credit') asc, pa.trains_on_data asc, pa.provider_slug asc
    ) filter (where pa.is_available = true),
    '[]'::jsonb
  ) as providers
from public.models m
left join public.provider_availability pa
  on pa.canonical_id = m.canonical_id
group by m.canonical_id
having count(pa.id) filter (where pa.is_available = true) > 0
order by m.freebench_score desc nulls last, m.display_name asc;

-- Row-Level Security (RLS)
alter table public.models enable row level security;
alter table public.provider_availability enable row level security;
alter table public.benchmark_scores enable row level security;
alter table public.unmapped_entities enable row level security;
alter table public.sync_runs enable row level security;
alter table public.availability_events enable row level security;
alter table public.pulse_items enable row level security;
alter table public.newsletter_subscribers enable row level security;

-- Public read-only policies
create policy "Public read models" on public.models
  for select to anon, authenticated using (true);

create policy "Public read provider_availability" on public.provider_availability
  for select to anon, authenticated using (true);

create policy "Public read benchmark_scores" on public.benchmark_scores
  for select to anon, authenticated using (true);

create policy "Public read unmapped_entities" on public.unmapped_entities
  for select to anon, authenticated using (true);

create policy "Public read sync_runs" on public.sync_runs
  for select to anon, authenticated using (true);

create policy "Public read availability_events" on public.availability_events
  for select to anon, authenticated using (true);

create policy "Public read pulse_items" on public.pulse_items
  for select to anon, authenticated using (true);

-- 9. Live Canary Probes & Crowdsourced 429 Reports
create table if not exists public.endpoint_probes (
  id bigint generated always as identity primary key,
  provider_slug text not null,
  provider_model_id text not null,
  ok boolean not null,
  http_status integer,
  ttft_ms integer,
  tokens_per_sec numeric(6, 1),
  discovered_rpm integer,
  discovered_rpd integer,
  discovered_tpm integer,
  error_message text,
  probed_at timestamptz not null default now()
);

create index if not exists idx_endpoint_probes_lookup
  on public.endpoint_probes (provider_slug, provider_model_id, probed_at desc);

create table if not exists public.rate_limit_reports (
  id bigint generated always as identity primary key,
  provider_slug text not null,
  provider_model_id text not null,
  reported_at timestamptz not null default now()
);

create index if not exists idx_rate_limit_reports_lookup
  on public.rate_limit_reports (provider_slug, provider_model_id, reported_at desc);

alter table public.endpoint_probes enable row level security;
alter table public.rate_limit_reports enable row level security;

create policy "Public read endpoint_probes" on public.endpoint_probes
  for select to anon, authenticated using (true);

create policy "Public read rate_limit_reports" on public.rate_limit_reports
  for select to anon, authenticated using (true);

create policy "Anon insert rate_limit_reports" on public.rate_limit_reports
  for insert to anon, authenticated with check (true);

-- Newsletter: anon can insert only; never select/update/delete
create policy "Anon insert newsletter_subscribers" on public.newsletter_subscribers
  for insert to anon, authenticated with check (true);
