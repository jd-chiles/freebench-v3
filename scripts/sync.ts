import {
  pollAiderPolyglot,
  pollBfcl,
  pollEpochBenchmarks,
  pollLiveBench,
  pollSweBenchVerified,
} from '@/lib/benchmarks';
import type {
  BenchmarkMetricKey,
  BenchmarkPollResult,
  BenchmarkSource,
} from '@/lib/benchmarks/types';
import { normalizeModelId } from '@/lib/normalization/normalize';
import {
  compute7dUptimePct,
  runRotatingCanaryProbes,
  selectStalestProbeTargets,
} from '@/lib/probes/canary';
import { pollAllProviders } from '@/lib/providers';
import {
  formatErrorMessage,
  isAuthExpiredError,
  shouldApplyDeactivation,
  tagProviderError,
} from '@/lib/providers/http';
import {
  dedupeDiscoveredModelsByCanonicalId,
  resolveEffectiveLimits,
} from '@/lib/providers/limits';
import { getProvidersConfig, type ProviderPollResult, type ProviderSlug } from '@/lib/providers/types';
import { getSiteUrl } from '@/lib/site';
import {
  dispatchAvailabilityEvents,
  dispatchKeyExpiredAlerts,
  type KeyExpiredAlert,
  type PendingAvailabilityEvent,
} from '@/lib/publishing/dispatch';
import { pollAllPulseSources } from '@/lib/pulse';
import {
  computeAgenticCodingScore,
  computeCohortCompositeScores,
} from '@/lib/scoring/composite';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import type { SyncErrorLogEntry } from '@/lib/supabase/types';

interface CliFlags {
  dryRun: boolean;
  providersOnly: boolean;
  benchmarksOnly: boolean;
  pulseOnly: boolean;
  probesOnly: boolean;
  withProbes: boolean;
  benchmarksIfStale: boolean;
  forceBenchmarks: boolean;
}

interface ModelBatchRow {
  canonical_id: string;
  display_name: string;
  family: string | null;
  parameter_count: string | null;
  context_window: number | null;
  supports_tools: boolean | null;
  supports_vision: boolean | null;
  is_open_weights: boolean | null;
}

interface ScoreUpsertRow {
  canonical_id: string;
  source: BenchmarkSource;
  metric_key: BenchmarkMetricKey;
  score: number;
  release_tag: string;
  raw_model_name: string;
  measured_at: string;
}

function logLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

function assertNoError(
  error: { message: string; code?: string } | null | undefined,
  context: string
): void {
  if (error) {
    throw new Error(`${context}: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  }
}

function parseFlags(argv: string[]): CliFlags {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
    providersOnly: args.has('--providers-only'),
    benchmarksOnly: args.has('--benchmarks-only'),
    pulseOnly: args.has('--pulse-only'),
    probesOnly: args.has('--probes-only'),
    withProbes: args.has('--with-probes'),
    benchmarksIfStale: args.has('--benchmarks-if-stale'),
    forceBenchmarks: args.has('--force-benchmarks'),
  };
}

function printDryRunSummary(
  providerResults: ProviderPollResult[],
  benchmarkResults: BenchmarkPollResult[],
  pulseCount: number
): void {
  logLine('\n=== FreeBench v0.0.1 Dry-Run Summary ===');

  if (providerResults.length > 0) {
    logLine('\n[Providers]');
    for (const res of providerResults) {
      if (res.ok) {
        logLine(
          `  OK   ${res.provider_slug.padEnd(13)} | ${String(res.models.length).padStart(3)} free models | ${res.duration_ms}ms`
        );
        const sample = res.models
          .slice(0, 3)
          .map((m) => `${m.provider_model_id} (trains=${m.trains_on_data})`)
          .join(', ');
        if (sample) {
          logLine(`       sample: ${sample}`);
        }
      } else {
        const tag = res.skipped ? 'SKIP' : 'ERR ';
        logLine(
          `  ${tag} ${res.provider_slug.padEnd(13)} | ${res.error ?? 'Unknown error'} | ${res.duration_ms}ms`
        );
      }
    }
  }

  if (benchmarkResults.length > 0) {
    logLine('\n[Benchmarks]');
    for (const res of benchmarkResults) {
      if (res.ok) {
        logLine(
          `  OK   ${res.source.padEnd(13)} | ${String(res.observations.length).padStart(4)} observations (${res.release_tag ?? 'latest'}) | ${res.duration_ms}ms`
        );
      } else {
        logLine(
          `  ERR  ${res.source.padEnd(13)} | ${res.error ?? 'Unknown error'} | ${res.duration_ms}ms`
        );
      }
    }
  }

  if (pulseCount > 0) {
    logLine(`\n[Pulse] Collected ${pulseCount} deduplicated feed items`);
  }
  logLine('');
}

async function getStaleBenchmarkSources(): Promise<BenchmarkSource[]> {
  const supabase = getSupabaseAdminClient();
  const sources: BenchmarkSource[] = ['epoch', 'livebench', 'bfcl', 'aider', 'swebench'];
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;

  const checks = await Promise.all(
    sources.map(async (source) => {
      const { data, error } = await supabase
        .from('benchmark_scores')
        .select('measured_at')
        .eq('source', source)
        .order('measured_at', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) return source;
      const latest = data[0]?.measured_at as string | undefined;
      if (!latest || Date.parse(latest) < cutoffMs) return source;
      return null;
    })
  );

  return checks.filter((s): s is BenchmarkSource => s !== null);
}

async function pollSelectedBenchmarks(sources: BenchmarkSource[]): Promise<BenchmarkPollResult[]> {
  if (sources.length === 0) return [];

  const runners: Record<BenchmarkSource, () => Promise<BenchmarkPollResult>> = {
    epoch: pollEpochBenchmarks,
    livebench: pollLiveBench,
    bfcl: pollBfcl,
    aider: pollAiderPolyglot,
    swebench: pollSweBenchVerified,
  };

  const settled = await Promise.allSettled(sources.map((source) => runners[source]()));
  return settled.map((outcome, idx) => {
    const source = sources[idx] ?? 'epoch';
    if (outcome.status === 'fulfilled') return outcome.value;
    return {
      source,
      ok: false,
      observations: [],
      error: formatErrorMessage(outcome.reason),
      duration_ms: 0,
    };
  });
}

async function triggerIsrRevalidation(canonicalIds: string[]): Promise<void> {
  const siteUrl = process.env.SITE_URL?.trim();
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (!siteUrl || !secret) return;

  try {
    const response = await fetch(`${siteUrl.replace(/\/$/, '')}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ canonicalIds }),
    });
    logLine(`[ISR] Revalidation HTTP ${response.status}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logLine(`[ISR] Revalidation skipped/failed: ${msg}`);
  }
}

function mergeModelBatchEntry(
  map: Map<string, ModelBatchRow>,
  incoming: ModelBatchRow
): void {
  const existing = map.get(incoming.canonical_id);
  if (!existing) {
    map.set(incoming.canonical_id, incoming);
    return;
  }

  existing.display_name = existing.display_name || incoming.display_name;
  existing.family = existing.family ?? incoming.family;
  existing.parameter_count = existing.parameter_count ?? incoming.parameter_count;
  existing.is_open_weights = existing.is_open_weights ?? incoming.is_open_weights;

  if (incoming.context_window !== null) {
    existing.context_window = Math.max(existing.context_window ?? 0, incoming.context_window);
  }
  if (incoming.supports_tools === true || existing.supports_tools === true) {
    existing.supports_tools = true;
  } else {
    existing.supports_tools = existing.supports_tools ?? incoming.supports_tools;
  }
  if (incoming.supports_vision === true || existing.supports_vision === true) {
    existing.supports_vision = true;
  } else {
    existing.supports_vision = existing.supports_vision ?? incoming.supports_vision;
  }
}

function shouldReplaceScoreRow(existing: ScoreUpsertRow, candidate: ScoreUpsertRow): boolean {
  if (candidate.source === 'livebench' && candidate.release_tag !== existing.release_tag) {
    return candidate.release_tag.localeCompare(existing.release_tag) > 0;
  }
  if (candidate.source === 'bfcl') {
    const existingFc = /\(FC\)/i.test(existing.raw_model_name);
    const candidateFc = /\(FC\)/i.test(candidate.raw_model_name);
    if (candidateFc && !existingFc) return true;
    if (existingFc && !candidateFc) return false;
  }
  return candidate.score > existing.score;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  const runProviders = !flags.benchmarksOnly && !flags.pulseOnly && !flags.probesOnly;
  let benchmarkSources: BenchmarkSource[] =
    !flags.providersOnly && !flags.pulseOnly && !flags.probesOnly
      ? ['epoch', 'livebench', 'bfcl', 'aider', 'swebench']
      : [];
  const runPulse = !flags.providersOnly && !flags.benchmarksOnly && !flags.probesOnly;
  const runProbes =
    flags.probesOnly ||
    flags.withProbes ||
    (!flags.benchmarksOnly && !flags.pulseOnly && !flags.providersOnly);

  if (!flags.dryRun && benchmarkSources.length > 0 && flags.benchmarksIfStale && !flags.forceBenchmarks) {
    benchmarkSources = await getStaleBenchmarkSources();
    if (benchmarkSources.length === 0) {
      logLine('[Benchmarks] All 5 benchmark sources < 24h old; skipping download');
    } else {
      logLine(`[Benchmarks] Refreshing stale sources: ${benchmarkSources.join(', ')}`);
    }
  }

  const [providerResults, benchmarkResults, pulseAggregate] = await Promise.all([
    runProviders ? pollAllProviders() : Promise.resolve<ProviderPollResult[]>([]),
    pollSelectedBenchmarks(benchmarkSources),
    runPulse ? pollAllPulseSources() : Promise.resolve({ items: [], results: [] }),
  ]);

  if (flags.dryRun) {
    printDryRunSummary(providerResults, benchmarkResults, pulseAggregate.items.length);
    return;
  }

  const supabase = getSupabaseAdminClient();
  const errorLog: SyncErrorLogEntry[] = [];

  const { data: runInsert, error: runInsertError } = await supabase
    .from('sync_runs')
    .insert({ status: 'running' })
    .select('id')
    .single();

  if (runInsertError || !runInsert) {
    throw new Error(`Failed to initialize sync_runs row: ${runInsertError?.message ?? 'unknown'}`);
  }
  const syncRunId = runInsert.id as string;

  const pendingEvents: PendingAvailabilityEvent[] = [];
  const keyExpiredAlerts: KeyExpiredAlert[] = [];
  let providersSucceeded = 0;
  let providersFailed = 0;
  let benchmarksUpdated = 0;
  let pulseItemsAdded = 0;
  const touchedCanonicalIds = new Set<string>();

  try {
    const { count: existingAvailCount, error: availCountError } = await supabase
      .from('provider_availability')
      .select('id', { count: 'exact', head: true });
    assertNoError(availCountError, 'Failed counting provider_availability');
    const isInitialSeed = (existingAvailCount ?? 0) === 0;

    // 1. Process provider poll results in batch
    const modelBatchMap = new Map<string, ModelBatchRow>();
    const unmappedBatchMap = new Map<string, Record<string, unknown>>();
    const resolvedProviderIdsBySlug = new Map<string, string[]>();

    for (const result of providerResults) {
      if (result.skipped) {
        continue;
      }

      if (!shouldApplyDeactivation(result)) {
        providersFailed += 1;
        const taggedError = tagProviderError(
          result.error ?? 'Zero models returned; existing rows preserved'
        );
        errorLog.push({
          provider: result.provider_slug,
          error: taggedError,
        });
        if (isAuthExpiredError(taggedError)) {
          keyExpiredAlerts.push({
            provider: result.provider_slug,
            envVar: getProvidersConfig()[result.provider_slug].env_var,
            error: taggedError,
          });
        }
        continue;
      }

      providersSucceeded += 1;

      const { data: previousRows, error: prevErr } = await supabase
        .from('provider_availability')
        .select('provider_model_id, rpm_limit, rpd_limit, rpm_int, rpd_int')
        .eq('provider_slug', result.provider_slug)
        .eq('is_available', true);
      assertNoError(prevErr, `Failed reading previous rows for ${result.provider_slug}`);

      const previousActiveMap = new Map<
        string,
        { rpm_limit: string; rpd_limit: string; rpm_int: number | null; rpd_int: number | null }
      >(
        (previousRows ?? []).map((r) => [
          r.provider_model_id as string,
          {
            rpm_limit: r.rpm_limit as string,
            rpd_limit: r.rpd_limit as string,
            rpm_int: (r.rpm_int as number | null) ?? null,
            rpd_int: (r.rpd_int as number | null) ?? null,
          },
        ])
      );

      const activeIds: string[] = [];
      const availabilityUpserts: Array<Record<string, unknown>> = [];
      const matchedRawIds: string[] = [];

      const dedupedModels = dedupeDiscoveredModelsByCanonicalId(result.models);

      for (const { model, norm } of dedupedModels) {
        activeIds.push(model.provider_model_id);
        touchedCanonicalIds.add(norm.canonicalId);

        if (!norm.matched) {
          unmappedBatchMap.set(`provider:${model.provider_slug}:${model.provider_model_id}`, {
            origin_type: 'provider',
            source_slug: model.provider_slug,
            raw_id: model.provider_model_id,
            suggested_canonical_id: norm.canonicalId,
            sample_metadata: {
              raw_display_name: model.raw_display_name ?? null,
              context_window: model.context_window,
            },
            last_seen_at: new Date().toISOString(),
          });
        } else {
          matchedRawIds.push(model.provider_model_id);
        }

        const effectiveContext = model.context_window ?? norm.fallbackContextWindow;

        mergeModelBatchEntry(modelBatchMap, {
          canonical_id: norm.canonicalId,
          display_name: norm.displayName,
          family: norm.family,
          parameter_count: norm.parameterCount,
          context_window: effectiveContext,
          supports_tools: model.supports_tools,
          supports_vision: model.supports_vision,
          is_open_weights: norm.isOpenWeights,
        });

        const resolvedLimits = resolveEffectiveLimits({
          provider_slug: model.provider_slug,
          provider_model_id: model.provider_model_id,
          rpm_limit: model.rpm_limit,
          rpd_limit: model.rpd_limit,
        });

        availabilityUpserts.push({
          canonical_id: norm.canonicalId,
          provider_slug: model.provider_slug,
          provider_model_id: model.provider_model_id,
          raw_display_name: model.raw_display_name ?? null,
          context_window: effectiveContext,
          supports_tools: model.supports_tools,
          supports_vision: model.supports_vision,
          rpm_limit: resolvedLimits.rpmLabel,
          rpd_limit: resolvedLimits.rpdLabel,
          rpm_int: resolvedLimits.rpmInt,
          rpd_int: resolvedLimits.rpdInt,
          tpm_int: resolvedLimits.tpmInt,
          tpd_int: resolvedLimits.tpdInt,
          quota_reset_tz: resolvedLimits.quotaResetTz,
          tier_type: model.tier_type,
          trains_on_data: model.trains_on_data,
          requires_credit_card: model.requires_credit_card,
          signup_url: model.signup_url,
          zdr_available: model.zdr_available ?? false,
          is_available: true,
          last_checked_at: new Date().toISOString(),
        });

        const prevOffering = previousActiveMap.get(model.provider_model_id);
        if (!isInitialSeed && !prevOffering) {
          pendingEvents.push({
            event_type: 'model_added',
            canonical_id: norm.canonicalId,
            provider_slug: model.provider_slug,
            provider_model_id: model.provider_model_id,
            freebench_score: null,
            headline: `${norm.displayName} is now free on ${model.provider_slug}`,
            summary_md: `Discovered \`${model.provider_model_id}\` on **${model.provider_slug}** (${resolvedLimits.rpmLabel}, ${resolvedLimits.rpdLabel}).`,
            published_channels: [],
          });
        } else if (
          !isInitialSeed &&
          prevOffering &&
          (prevOffering.rpm_limit !== resolvedLimits.rpmLabel ||
            prevOffering.rpd_limit !== resolvedLimits.rpdLabel)
        ) {
          pendingEvents.push({
            event_type: 'quota_changed',
            canonical_id: norm.canonicalId,
            provider_slug: model.provider_slug,
            provider_model_id: model.provider_model_id,
            freebench_score: null,
            headline: `${norm.displayName} quota updated on ${model.provider_slug}`,
            summary_md: `Free limits on **${model.provider_slug}** changed from ${prevOffering.rpm_limit} / ${prevOffering.rpd_limit} to ${resolvedLimits.rpmLabel} / ${resolvedLimits.rpdLabel}.`,
            published_channels: [],
          });
        }
      }

      if (matchedRawIds.length > 0) {
        resolvedProviderIdsBySlug.set(result.provider_slug, matchedRawIds);
      }

      // Flush canonical models for this batch before provider_availability FK upsert
      if (modelBatchMap.size > 0) {
        const { error: modelBatchErr } = await supabase.rpc('upsert_models_batch', {
          p_models: [...modelBatchMap.values()],
        });
        assertNoError(modelBatchErr, 'upsert_models_batch failed (providers)');
        modelBatchMap.clear();
      }

      if (availabilityUpserts.length > 0) {
        const { error: availErr } = await supabase
          .from('provider_availability')
          .upsert(availabilityUpserts, {
            onConflict: 'provider_slug,provider_model_id',
          });
        assertNoError(availErr, `provider_availability upsert failed for ${result.provider_slug}`);
      }

      const { data: deactivatedRows, error: deactErr } = await supabase.rpc(
        'deactivate_stale_provider_models',
        {
          p_provider_slug: result.provider_slug,
          p_active_ids: activeIds,
        }
      );
      assertNoError(deactErr, `deactivate_stale_provider_models failed for ${result.provider_slug}`);

      if (!isInitialSeed && Array.isArray(deactivatedRows)) {
        for (const dropped of deactivatedRows) {
          const canonicalId = dropped.canonical_id as string;
          const providerModelId = dropped.provider_model_id as string;
          pendingEvents.push({
            event_type: 'model_dropped',
            canonical_id: canonicalId,
            provider_slug: result.provider_slug,
            provider_model_id: providerModelId,
            freebench_score: null,
            headline: `${canonicalId} dropped from ${result.provider_slug} free tier`,
            summary_md: `\`${providerModelId}\` was removed or became unavailable on **${result.provider_slug}**.`,
            published_channels: [],
          });
        }
      }
    }

    for (const [slug, matchedRawIds] of resolvedProviderIdsBySlug.entries()) {
      const { error: markMappedErr } = await supabase
        .from('unmapped_entities')
        .update({ status: 'mapped', last_seen_at: new Date().toISOString() })
        .eq('origin_type', 'provider')
        .eq('source_slug', slug)
        .eq('status', 'pending')
        .in('raw_id', matchedRawIds);
      assertNoError(markMappedErr, `Failed marking mapped unmapped_entities for ${slug}`);
    }

    // 2. Process benchmark observations (including alias-matched canonical models not yet active)
    const { data: leaderBeforeRows, error: leaderBeforeErr } = await supabase
      .from('v_leaderboard_models')
      .select('canonical_id')
      .order('freebench_score', { ascending: false, nullsFirst: false })
      .limit(1);
    assertNoError(leaderBeforeErr, 'Failed reading current #1 leader');
    const previousLeaderId = (leaderBeforeRows?.[0]?.canonical_id as string | undefined) ?? null;

    const { data: existingModelsRows, error: existingModelsErr } = await supabase
      .from('models')
      .select('canonical_id');
    assertNoError(existingModelsErr, 'Failed reading existing model IDs');
    const existingModelIds = new Set((existingModelsRows ?? []).map((m) => m.canonical_id as string));

    const benchmarkModelBatch = new Map<string, ModelBatchRow>();
    const dedupScoreMap = new Map<string, ScoreUpsertRow>();

    for (const bResult of benchmarkResults) {
      if (!bResult.ok) {
        errorLog.push({
          source: bResult.source,
          error: bResult.error ?? 'Benchmark fetch failed',
        });
        continue;
      }

      const nowIso = new Date().toISOString();
      const matchedBenchmarkRawIds: string[] = [];

      for (const obs of bResult.observations) {
        const norm = normalizeModelId(obs.raw_model_name);
        if (!norm.matched && !existingModelIds.has(norm.canonicalId)) {
          unmappedBatchMap.set(`benchmark:${obs.source}:${obs.raw_model_name}`, {
            origin_type: 'benchmark',
            source_slug: obs.source,
            raw_id: obs.raw_model_name,
            suggested_canonical_id: norm.canonicalId,
            sample_metadata: { metric_key: obs.metric_key, score: obs.score },
            last_seen_at: nowIso,
          });
          continue;
        }

        if (norm.matched) {
          matchedBenchmarkRawIds.push(obs.raw_model_name);
        }

        if (!existingModelIds.has(norm.canonicalId)) {
          mergeModelBatchEntry(benchmarkModelBatch, {
            canonical_id: norm.canonicalId,
            display_name: norm.displayName,
            family: norm.family,
            parameter_count: norm.parameterCount,
            context_window: norm.fallbackContextWindow,
            supports_tools: null,
            supports_vision: null,
            is_open_weights: norm.isOpenWeights,
          });
          existingModelIds.add(norm.canonicalId);
        }

        const dedupKey = `${norm.canonicalId}:${obs.source}:${obs.metric_key}`;
        const candidate: ScoreUpsertRow = {
          canonical_id: norm.canonicalId,
          source: obs.source,
          metric_key: obs.metric_key,
          score: obs.score,
          release_tag: obs.release_tag,
          raw_model_name: obs.raw_model_name,
          measured_at: nowIso,
        };

        const existingScore = dedupScoreMap.get(dedupKey);
        if (!existingScore || shouldReplaceScoreRow(existingScore, candidate)) {
          dedupScoreMap.set(dedupKey, candidate);
        }
      }

      if (matchedBenchmarkRawIds.length > 0) {
        const uniqueRaw = [...new Set(matchedBenchmarkRawIds)];
        const { error: markBenchErr } = await supabase
          .from('unmapped_entities')
          .update({ status: 'mapped', last_seen_at: nowIso })
          .eq('origin_type', 'benchmark')
          .eq('source_slug', bResult.source)
          .eq('status', 'pending')
          .in('raw_id', uniqueRaw);
        assertNoError(markBenchErr, `Failed marking mapped benchmarks for ${bResult.source}`);
      }
    }

    if (benchmarkModelBatch.size > 0) {
      const { error: benchModelErr } = await supabase.rpc('upsert_models_batch', {
        p_models: [...benchmarkModelBatch.values()],
      });
      assertNoError(benchModelErr, 'upsert_models_batch failed (benchmarks)');
    }

    if (unmappedBatchMap.size > 0) {
      const { error: unmappedErr } = await supabase.rpc('upsert_unmapped_entities_batch', {
        p_items: [...unmappedBatchMap.values()],
      });
      assertNoError(unmappedErr, 'upsert_unmapped_entities_batch failed');
    }

    const scoreRows = [...dedupScoreMap.values()];
    if (scoreRows.length > 0) {
      const { error: scoreUpsertErr } = await supabase
        .from('benchmark_scores')
        .upsert(scoreRows, {
          onConflict: 'canonical_id,source,metric_key',
        });
      assertNoError(scoreUpsertErr, 'benchmark_scores upsert failed');
      benchmarksUpdated = scoreRows.length;
    }

    // 3. Bulk recompute denormalized benchmark pillars & composite scores on `models`
    const [{ data: allModels, error: allModelsErr }, { data: allScores, error: allScoresErr }] =
      await Promise.all([
        supabase.from('models').select('canonical_id, display_name, context_window, supports_tools'),
        supabase.from('benchmark_scores').select('canonical_id, metric_key, score'),
      ]);
    assertNoError(allModelsErr, 'Failed reading models for score rollup');
    assertNoError(allScoresErr, 'Failed reading benchmark_scores for score rollup');

    const { data: activeProviderModelRows, error: activeProviderModelsErr } = await supabase
      .from('provider_availability')
      .select('canonical_id')
      .eq('is_available', true);
    assertNoError(activeProviderModelsErr, 'Failed reading active provider models');
    const activeCanonicalSet = new Set(
      (activeProviderModelRows ?? []).map((r) => r.canonical_id as string)
    );

    const scoresByModel = new Map<string, Partial<Record<BenchmarkMetricKey, number>>>();
    for (const row of allScores ?? []) {
      const cid = row.canonical_id as string;
      const metric = row.metric_key as BenchmarkMetricKey;
      const val = Number(row.score);
      if (!Number.isFinite(val)) continue;
      const bucket = scoresByModel.get(cid) ?? {};
      bucket[metric] = val;
      scoresByModel.set(cid, bucket);
    }

    let newLeaderCandidate: { id: string; name: string; score: number } | null = null;
    const bulkScoreUpdates: Array<Record<string, unknown>> = [];
    const modelRowsList = allModels ?? [];
    const cohortComposites = computeCohortCompositeScores(
      modelRowsList.map((model) => {
        const mScores = scoresByModel.get(model.canonical_id as string) ?? {};
        return {
          eci: mScores.eci_score,
          livebenchGlobal: mScores.livebench_global,
          bfclOverall: mScores.bfcl_overall,
        };
      })
    );

    for (let idx = 0; idx < modelRowsList.length; idx += 1) {
      const model = modelRowsList[idx]!;
      const cid = model.canonical_id as string;
      const mScores = scoresByModel.get(cid) ?? {};
      const composite = cohortComposites[idx] ?? { freebenchScore: null, coverageCount: 0 };
      const agenticScore = computeAgenticCodingScore({
        swebenchVerified: mScores.swebench_verified,
        aiderPolyglot: mScores.aider_polyglot,
        livebenchCoding: mScores.livebench_coding,
        bfclOverall: mScores.bfcl_overall,
        livebenchReasoning: mScores.livebench_reasoning,
        contextWindow: (model.context_window as number | null) ?? null,
        supportsTools: (model.supports_tools as boolean | null) ?? null,
      });

      if (
        activeCanonicalSet.has(cid) &&
        composite.freebenchScore !== null &&
        composite.coverageCount >= 2 &&
        (!newLeaderCandidate || composite.freebenchScore > newLeaderCandidate.score)
      ) {
        newLeaderCandidate = {
          id: cid,
          name: model.display_name as string,
          score: composite.freebenchScore,
        };
      }

      bulkScoreUpdates.push({
        canonical_id: cid,
        eci_score: mScores.eci_score ?? null,
        livebench_global: mScores.livebench_global ?? null,
        livebench_coding: mScores.livebench_coding ?? null,
        livebench_reasoning: mScores.livebench_reasoning ?? null,
        livebench_math: mScores.livebench_math ?? null,
        livebench_if: mScores.livebench_if ?? null,
        livebench_data: mScores.livebench_data ?? null,
        bfcl_overall: mScores.bfcl_overall ?? null,
        aider_polyglot: mScores.aider_polyglot ?? null,
        swebench_verified: mScores.swebench_verified ?? null,
        freebench_score: composite.freebenchScore,
        agentic_coding_score: agenticScore,
        benchmark_coverage: composite.coverageCount,
      });
    }

    if (bulkScoreUpdates.length > 0) {
      const { error: bulkScoreErr } = await supabase.rpc('bulk_update_model_scores', {
        p_scores: bulkScoreUpdates,
      });
      assertNoError(bulkScoreErr, 'bulk_update_model_scores failed');
    }

    if (
      !isInitialSeed &&
      newLeaderCandidate &&
      previousLeaderId &&
      newLeaderCandidate.id !== previousLeaderId
    ) {
      pendingEvents.push({
        event_type: 'new_leader',
        canonical_id: newLeaderCandidate.id,
        provider_slug: null,
        provider_model_id: null,
        freebench_score: newLeaderCandidate.score,
        headline: `${newLeaderCandidate.name} takes #1 on FreeBench (${newLeaderCandidate.score.toFixed(1)})`,
        summary_md: `**${newLeaderCandidate.name}** is now the highest-scoring free-tier model with a FreeBench composite score of **${newLeaderCandidate.score.toFixed(1)}**.`,
        published_channels: [],
      });
    }

    // 3.5 Rotating zero-cost canary probes (stalest 18 active endpoints) + 24h 429 report rollups
    if (runProbes) {
      const { data: probeCandidates, error: probeCandErr } = await supabase
        .from('provider_availability')
        .select('provider_slug, provider_model_id, last_probe_at')
        .eq('is_available', true)
        .order('last_probe_at', { ascending: true, nullsFirst: true })
        .limit(120);
      assertNoError(probeCandErr, 'Failed reading probe candidates');

      const probeTargets = selectStalestProbeTargets(
        (probeCandidates ?? []).map((r) => ({
          provider_slug: r.provider_slug as ProviderSlug,
          provider_model_id: r.provider_model_id as string,
          last_probe_at: (r.last_probe_at as string | null) ?? null,
        })),
        18
      );

      const probeResults = await runRotatingCanaryProbes(probeTargets, 4);

      if (probeResults.length > 0) {
        const { error: probeInsertErr } = await supabase
          .from('endpoint_probes')
          .insert(probeResults);
        assertNoError(probeInsertErr, 'endpoint_probes insert failed');

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const [{ data: recentProbeRows, error: recentProbesErr }, { data: recent429Rows, error: recent429Err }] =
          await Promise.all([
            supabase
              .from('endpoint_probes')
              .select('provider_slug, provider_model_id, ok')
              .gte('probed_at', sevenDaysAgo)
              .limit(2000),
            supabase
              .from('rate_limit_reports')
              .select('provider_slug, provider_model_id')
              .gte('reported_at', oneDayAgo)
              .limit(2000),
          ]);
        assertNoError(recentProbesErr, 'Failed reading 7d probe samples');
        assertNoError(recent429Err, 'Failed reading 24h rate_limit_reports');

        const samplesByPair = new Map<string, Array<{ ok: boolean }>>();
        for (const row of recentProbeRows ?? []) {
          const key = `${row.provider_slug}:${row.provider_model_id}`;
          const list = samplesByPair.get(key) ?? [];
          list.push({ ok: Boolean(row.ok) });
          samplesByPair.set(key, list);
        }

        const reportsByPair = new Map<string, number>();
        for (const row of recent429Rows ?? []) {
          const key = `${row.provider_slug}:${row.provider_model_id}`;
          reportsByPair.set(key, (reportsByPair.get(key) ?? 0) + 1);
        }

        for (const probe of probeResults) {
          const key = `${probe.provider_slug}:${probe.provider_model_id}`;
          const uptime7d = compute7dUptimePct(samplesByPair.get(key) ?? [{ ok: probe.ok }]);
          const reports24h = reportsByPair.get(key) ?? 0;

          const updatePayload: Record<string, unknown> = {
            last_probe_at: probe.probed_at,
            last_probe_ok: probe.ok,
            last_probe_status: probe.http_status,
            ttft_ms: probe.ttft_ms,
            tokens_per_sec: probe.tokens_per_sec,
            uptime_7d: uptime7d,
            rate_limit_reports_24h: reports24h,
          };
          if (probe.discovered_rpm !== null) updatePayload.rpm_int = probe.discovered_rpm;
          if (probe.discovered_rpd !== null) updatePayload.rpd_int = probe.discovered_rpd;
          if (probe.discovered_tpm !== null) updatePayload.tpm_int = probe.discovered_tpm;

          const { error: probeUpdateErr } = await supabase
            .from('provider_availability')
            .update(updatePayload)
            .eq('provider_slug', probe.provider_slug)
            .eq('provider_model_id', probe.provider_model_id);
          assertNoError(
            probeUpdateErr,
            `Failed updating probe telemetry for ${probe.provider_slug}:${probe.provider_model_id}`
          );
        }

        const { error: pruneProbesErr } = await supabase
          .from('endpoint_probes')
          .delete()
          .lt('probed_at', sevenDaysAgo);
        assertNoError(pruneProbesErr, 'Failed pruning old endpoint_probes');

        const { error: prune429Err } = await supabase
          .from('rate_limit_reports')
          .delete()
          .lt('reported_at', sevenDaysAgo);
        assertNoError(prune429Err, 'Failed pruning old rate_limit_reports');
      }
    }

    // 4. Upsert pulse items + deterministic FreeBench event URLs
    const pulseRows = [...pulseAggregate.items];
    const siteUrl = getSiteUrl();
    for (const evt of pendingEvents.slice(0, 5)) {
      const url = `${siteUrl}/models/${encodeURIComponent(
        evt.canonical_id
      )}?event=${encodeURIComponent(evt.event_type)}&provider=${encodeURIComponent(
        evt.provider_slug ?? 'overall'
      )}`;
      pulseRows.push({
        source_id: 'freebench-radar',
        source_name: 'FreeBench Radar',
        source_handle: null,
        source_type: 'freebench_event',
        category_tags: [evt.event_type, evt.provider_slug ?? 'leaderboard'].filter(Boolean),
        title: evt.headline,
        summary: evt.summary_md.replace(/[*`]/g, ''),
        url,
        published_at: new Date().toISOString(),
      });
    }

    if (pulseRows.length > 0) {
      const { error: pulseErr } = await supabase
        .from('pulse_items')
        .upsert(pulseRows, { onConflict: 'url' });
      assertNoError(pulseErr, 'pulse_items upsert failed');
      pulseItemsAdded = pulseRows.length;
    }

    // 5. Persist availability events & dispatch webhooks
    if (pendingEvents.length > 0) {
      const channels = await dispatchAvailabilityEvents(pendingEvents);
      const { error: evtErr } = await supabase.from('availability_events').insert(
        pendingEvents.map((evt) => ({
          ...evt,
          published_channels: channels,
        }))
      );
      assertNoError(evtErr, 'availability_events insert failed');
    }

    if (keyExpiredAlerts.length > 0) {
      await dispatchKeyExpiredAlerts(keyExpiredAlerts);
    }

    // 6. Free-tier storage pruning: keep 300 newest pulse_items and 90d of sync_runs
    const { data: oldPulseIds, error: oldPulseErr } = await supabase
      .from('pulse_items')
      .select('id')
      .order('published_at', { ascending: false })
      .range(300, 1000);
    assertNoError(oldPulseErr, 'Failed reading old pulse_items');

    if (oldPulseIds && oldPulseIds.length > 0) {
      const { error: prunePulseErr } = await supabase
        .from('pulse_items')
        .delete()
        .in(
          'id',
          oldPulseIds.map((r) => r.id as number)
        );
      assertNoError(prunePulseErr, 'Failed pruning old pulse_items');
    }

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { error: pruneSyncErr } = await supabase
      .from('sync_runs')
      .delete()
      .lt('started_at', ninetyDaysAgo);
    assertNoError(pruneSyncErr, 'Failed pruning old sync_runs');

    const { count: activeCount, error: activeCountErr } = await supabase
      .from('provider_availability')
      .select('id', { count: 'exact', head: true })
      .eq('is_available', true);
    assertNoError(activeCountErr, 'Failed counting active offerings');

    const finalStatus =
      errorLog.length === 0
        ? 'success'
        : providersSucceeded > 0 || benchmarksUpdated > 0 || pulseItemsAdded > 0
          ? 'partial'
          : 'failed';

    const { error: finishErr } = await supabase
      .from('sync_runs')
      .update({
        completed_at: new Date().toISOString(),
        status: finalStatus,
        providers_succeeded: providersSucceeded,
        providers_failed: providersFailed,
        models_active: activeCount ?? 0,
        benchmarks_updated: benchmarksUpdated,
        pulse_items_added: pulseItemsAdded,
        error_log: errorLog,
      })
      .eq('id', syncRunId);
    assertNoError(finishErr, 'Failed finalizing sync_runs');

    await triggerIsrRevalidation([...touchedCanonicalIds]);

    logLine(
      `[Sync Complete] status=${finalStatus} providers_ok=${providersSucceeded} providers_failed=${providersFailed} active_models=${activeCount ?? 0} benchmarks_updated=${benchmarksUpdated} pulse_items=${pulseItemsAdded}`
    );
  } catch (error) {
    const message = formatErrorMessage(error);
    errorLog.push({ source: 'orchestrator', error: message });
    await supabase
      .from('sync_runs')
      .update({
        completed_at: new Date().toISOString(),
        status: 'failed',
        providers_succeeded: providersSucceeded,
        providers_failed: providersFailed,
        benchmarks_updated: benchmarksUpdated,
        pulse_items_added: pulseItemsAdded,
        error_log: errorLog,
      })
      .eq('id', syncRunId);
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`Sync failed: ${message}\n`);
  process.exitCode = 1;
});
