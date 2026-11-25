-- FreeBench FB-Eval v1 Migration (Idempotent)
-- Adds deterministic FB-Eval v1 score columns on models, eval_runs history table,
-- 'freebench_eval' benchmark source, and updated RPC/view preserving FB-Eval scores on sync.

alter table public.models
  add column if not exists fb_eval_score numeric(6, 2),
  add column if not exists fb_eval_coding numeric(6, 2),
  add column if not exists fb_eval_tools numeric(6, 2),
  add column if not exists fb_eval_if numeric(6, 2),
  add column if not exists fb_eval_reasoning numeric(6, 2),
  add column if not exists fb_eval_version text,
  add column if not exists fb_eval_measured_at timestamptz;

alter table public.benchmark_scores
  drop constraint if exists benchmark_scores_source_check;

alter table public.benchmark_scores
  add constraint benchmark_scores_source_check
  check (source in ('epoch', 'livebench', 'bfcl', 'aider', 'swebench', 'freebench_eval'));

create table if not exists public.eval_runs (
  id bigint generated always as identity primary key,
  canonical_id text not null references public.models(canonical_id) on delete cascade,
  provider_slug text not null,
  provider_model_id text not null,
  suite_version text not null,
  seed_tag text not null,
  overall_score numeric(6, 2) not null,
  coding_score numeric(6, 2) not null,
  tools_score numeric(6, 2) not null,
  if_score numeric(6, 2) not null,
  reasoning_score numeric(6, 2) not null,
  passed_count integer not null,
  total_count integer not null,
  avg_latency_ms integer,
  prompt_results jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now()
);

create index if not exists idx_eval_runs_canonical_evaluated
  on public.eval_runs (canonical_id, evaluated_at desc);

alter table public.eval_runs enable row level security;

drop policy if exists "Public read eval_runs" on public.eval_runs;
create policy "Public read eval_runs" on public.eval_runs
  for select to anon, authenticated using (true);

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
    fb_eval_score = coalesce(s.fb_eval_score, m.fb_eval_score),
    fb_eval_coding = coalesce(s.fb_eval_coding, m.fb_eval_coding),
    fb_eval_tools = coalesce(s.fb_eval_tools, m.fb_eval_tools),
    fb_eval_if = coalesce(s.fb_eval_if, m.fb_eval_if),
    fb_eval_reasoning = coalesce(s.fb_eval_reasoning, m.fb_eval_reasoning),
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
    benchmark_coverage smallint,
    fb_eval_score numeric(6, 2),
    fb_eval_coding numeric(6, 2),
    fb_eval_tools numeric(6, 2),
    fb_eval_if numeric(6, 2),
    fb_eval_reasoning numeric(6, 2)
  )
  where m.canonical_id = s.canonical_id;
end;
$$;

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
  m.fb_eval_score,
  m.fb_eval_coding,
  m.fb_eval_tools,
  m.fb_eval_if,
  m.fb_eval_reasoning,
  m.fb_eval_version,
  m.fb_eval_measured_at,
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
