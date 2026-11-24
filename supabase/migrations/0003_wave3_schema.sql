-- FreeBench Wave 3 Migration (Idempotent)
-- Adds live canary probe telemetry, endpoint_probes history, crowdsourced rate_limit_reports,
-- and quota_changed availability events.

alter table public.provider_availability
  add column if not exists last_probe_at timestamptz,
  add column if not exists last_probe_ok boolean,
  add column if not exists last_probe_status integer,
  add column if not exists ttft_ms integer,
  add column if not exists tokens_per_sec numeric(6, 1),
  add column if not exists uptime_7d numeric(5, 2),
  add column if not exists rate_limit_reports_24h integer not null default 0;

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

alter table public.availability_events
  drop constraint if exists availability_events_event_type_check;

alter table public.availability_events
  add constraint availability_events_event_type_check
  check (event_type in ('model_added', 'model_dropped', 'new_leader', 'quota_changed'));

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

alter table public.endpoint_probes enable row level security;
alter table public.rate_limit_reports enable row level security;

drop policy if exists "Public read endpoint_probes" on public.endpoint_probes;
create policy "Public read endpoint_probes" on public.endpoint_probes
  for select to anon, authenticated using (true);

drop policy if exists "Public read rate_limit_reports" on public.rate_limit_reports;
create policy "Public read rate_limit_reports" on public.rate_limit_reports
  for select to anon, authenticated using (true);

drop policy if exists "Anon insert rate_limit_reports" on public.rate_limit_reports;
create policy "Anon insert rate_limit_reports" on public.rate_limit_reports
  for insert to anon, authenticated with check (true);
