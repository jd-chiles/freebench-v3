-- FreeBench Wave 2 Migration (Idempotent)
-- Adds Aider Polyglot & SWE-bench Verified columns plus structured provider rate limit columns.

alter table public.models
  add column if not exists aider_polyglot numeric(6, 2),
  add column if not exists swebench_verified numeric(6, 2);

alter table public.provider_availability
  add column if not exists rpm_int integer,
  add column if not exists rpd_int integer,
  add column if not exists tpm_int integer,
  add column if not exists tpd_int integer,
  add column if not exists quota_reset_tz text;

alter table public.benchmark_scores
  drop constraint if exists benchmark_scores_source_check;

alter table public.benchmark_scores
  add constraint benchmark_scores_source_check
  check (source in ('epoch', 'livebench', 'bfcl', 'aider', 'swebench'));

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
        'last_checked_at', pa.last_checked_at
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
