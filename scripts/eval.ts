import fs from 'node:fs';
import path from 'node:path';
import {
  buildCalibrationReport,
  evaluateModel,
} from '@/lib/evals/runner';
import { buildEvalSuite, getCurrentSeedTag } from '@/lib/evals/suite';
import { FB_EVAL_SUITE_VERSION, type ModelEvalSummary } from '@/lib/evals/types';
import { parseEnvFile } from '@/lib/keys/manager';
import { getProvidersConfig } from '@/lib/providers/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import type { LeaderboardModel, ProviderOffering, ProviderSlug } from '@/lib/supabase/types';

interface EvalCliFlags {
  dryRun: boolean;
  calibrate: boolean;
  unscored: boolean;
  write: boolean;
  modelFilter: string | null;
  providerFilter: ProviderSlug | null;
  limit: number | null;
  seedTag: string;
  delayMs: number;
}

const PREFERRED_EVAL_PROVIDERS: ReadonlyArray<ProviderSlug> = [
  'groq',
  'mistral',
  'google',
  'openrouter',
  'cloudflare',
  'nvidia',
  'sambanova',
  'cerebras',
  'cohere',
  'chutes',
  'siliconflow',
  'zai',
  'pollinations',
];

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const parsed = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (!process.env[k] && v) {
      process.env[k] = v;
    }
  }
}

function parseFlags(argv: string[]): EvalCliFlags {
  const args = argv.slice(2);
  let dryRun = false;
  let calibrate = false;
  let unscored = false;
  let write = false;
  let modelFilter: string | null = null;
  let providerFilter: ProviderSlug | null = null;
  let limit: number | null = null;
  let seedTag = getCurrentSeedTag();
  let delayMs = 400;

  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--calibrate') calibrate = true;
    else if (arg === '--unscored') unscored = true;
    else if (arg === '--write') write = true;
    else if (arg.startsWith('--model=')) modelFilter = arg.slice('--model='.length).trim();
    else if (arg.startsWith('--provider=')) {
      providerFilter = arg.slice('--provider='.length).trim() as ProviderSlug;
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    } else if (arg.startsWith('--seed=')) {
      seedTag = arg.slice('--seed='.length).trim() || seedTag;
    } else if (arg.startsWith('--delay=')) {
      const n = Number(arg.slice('--delay='.length));
      if (Number.isFinite(n) && n >= 0) delayMs = Math.floor(n);
    }
  }

  if (!dryRun && !calibrate && !unscored && !modelFilter) {
    unscored = true;
  }

  return {
    dryRun,
    calibrate,
    unscored,
    write,
    modelFilter,
    providerFilter,
    limit,
    seedTag,
    delayMs,
  };
}

function hasEvalCredentials(slug: ProviderSlug): boolean {
  if (slug === 'pollinations') return true;
  const cfg = getProvidersConfig()[slug];
  if (!cfg || cfg.access_mode === 'harness_only') return false;
  if (slug === 'cloudflare') {
    return Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim()
    );
  }
  return Boolean(process.env[cfg.env_var]?.trim());
}

function pickBestOffering(
  offerings: ProviderOffering[],
  providerFilter: ProviderSlug | null
): ProviderOffering | null {
  const eligible = offerings.filter((o) => {
    if (providerFilter && o.provider_slug !== providerFilter) return false;
    return hasEvalCredentials(o.provider_slug);
  });
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    const idxA = PREFERRED_EVAL_PROVIDERS.indexOf(a.provider_slug);
    const idxB = PREFERRED_EVAL_PROVIDERS.indexOf(b.provider_slug);
    return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
  });
  return eligible[0] ?? null;
}

async function fetchLiveModels(): Promise<LeaderboardModel[]> {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('v_leaderboard_models')
      .select('*')
      .order('freebench_score', { ascending: false, nullsFirst: false });
    if (error) {
      throw new Error(`Failed reading v_leaderboard_models: ${error.message}`);
    }
    return (data ?? []) as LeaderboardModel[];
  }

  const siteUrl = (process.env.SITE_URL?.trim() || 'https://freebench-v3.vercel.app').replace(
    /\/$/,
    ''
  );
  const res = await fetch(`${siteUrl}/api/v1/models`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Failed fetching ${siteUrl}/api/v1/models (HTTP ${res.status})`);
  }
  const payload = (await res.json()) as { models?: LeaderboardModel[] };
  return payload.models ?? [];
}

function selectStratifiedAnchors(
  models: LeaderboardModel[],
  limit: number,
  providerFilter: ProviderSlug | null
): Array<{ model: LeaderboardModel; offering: ProviderOffering }> {
  const eligible = models
    .filter((m) => typeof m.freebench_score === 'number')
    .map((model) => ({ model, offering: pickBestOffering(model.providers, providerFilter) }))
    .filter(
      (item): item is { model: LeaderboardModel; offering: ProviderOffering } =>
        item.offering !== null
    )
    .sort((a, b) => (b.model.freebench_score ?? 0) - (a.model.freebench_score ?? 0));

  if (eligible.length <= limit) return eligible;

  const selected: Array<{ model: LeaderboardModel; offering: ProviderOffering }> = [];
  for (let i = 0; i < limit; i += 1) {
    const idx = Math.round((i * (eligible.length - 1)) / Math.max(1, limit - 1));
    const candidate = eligible[idx];
    if (candidate && !selected.some((s) => s.model.canonical_id === candidate.model.canonical_id)) {
      selected.push(candidate);
    }
  }
  return selected;
}

async function persistEvalSummaries(summaries: ModelEvalSummary[]): Promise<void> {
  if (summaries.length === 0) return;
  const supabase = getSupabaseAdminClient();

  const runRows = summaries.map((s) => ({
    canonical_id: s.canonicalId,
    provider_slug: s.providerSlug,
    provider_model_id: s.providerModelId,
    suite_version: s.suiteVersion,
    seed_tag: s.seedTag,
    overall_score: s.overallScore,
    coding_score: s.pillarScores.coding,
    tools_score: s.pillarScores.tools,
    if_score: s.pillarScores.if,
    reasoning_score: s.pillarScores.reasoning,
    passed_count: s.passedCount,
    total_count: s.totalCount,
    avg_latency_ms: s.avgLatencyMs,
    prompt_results: s.promptResults,
    evaluated_at: s.evaluatedAt,
  }));
  const { error: runErr } = await supabase.from('eval_runs').insert(runRows);
  if (runErr) throw new Error(`eval_runs insert failed: ${runErr.message}`);

  const scoreRows = summaries.flatMap((s) => [
    {
      canonical_id: s.canonicalId,
      source: 'freebench_eval',
      metric_key: 'fb_eval_score',
      score: s.overallScore,
      release_tag: `${s.suiteVersion}:${s.seedTag}`,
      raw_model_name: s.providerModelId,
      measured_at: s.evaluatedAt,
    },
    {
      canonical_id: s.canonicalId,
      source: 'freebench_eval',
      metric_key: 'fb_eval_coding',
      score: s.pillarScores.coding,
      release_tag: `${s.suiteVersion}:${s.seedTag}`,
      raw_model_name: s.providerModelId,
      measured_at: s.evaluatedAt,
    },
    {
      canonical_id: s.canonicalId,
      source: 'freebench_eval',
      metric_key: 'fb_eval_tools',
      score: s.pillarScores.tools,
      release_tag: `${s.suiteVersion}:${s.seedTag}`,
      raw_model_name: s.providerModelId,
      measured_at: s.evaluatedAt,
    },
    {
      canonical_id: s.canonicalId,
      source: 'freebench_eval',
      metric_key: 'fb_eval_if',
      score: s.pillarScores.if,
      release_tag: `${s.suiteVersion}:${s.seedTag}`,
      raw_model_name: s.providerModelId,
      measured_at: s.evaluatedAt,
    },
    {
      canonical_id: s.canonicalId,
      source: 'freebench_eval',
      metric_key: 'fb_eval_reasoning',
      score: s.pillarScores.reasoning,
      release_tag: `${s.suiteVersion}:${s.seedTag}`,
      raw_model_name: s.providerModelId,
      measured_at: s.evaluatedAt,
    },
  ]);

  const { error: scoreErr } = await supabase
    .from('benchmark_scores')
    .upsert(scoreRows, { onConflict: 'canonical_id,source,metric_key' });
  if (scoreErr) throw new Error(`benchmark_scores upsert failed: ${scoreErr.message}`);

  for (const s of summaries) {
    const { error: updErr } = await supabase
      .from('models')
      .update({
        fb_eval_score: s.overallScore,
        fb_eval_coding: s.pillarScores.coding,
        fb_eval_tools: s.pillarScores.tools,
        fb_eval_if: s.pillarScores.if,
        fb_eval_reasoning: s.pillarScores.reasoning,
        fb_eval_version: `${s.suiteVersion}:${s.seedTag}`,
        fb_eval_measured_at: s.evaluatedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('canonical_id', s.canonicalId);
    if (updErr) throw new Error(`models update failed (${s.canonicalId}): ${updErr.message}`);
  }

  const siteUrl = process.env.SITE_URL?.trim();
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (siteUrl && secret) {
    await fetch(`${siteUrl.replace(/\/$/, '')}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ canonicalIds: summaries.map((s) => s.canonicalId) }),
    }).catch(() => {});
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const flags = parseFlags(process.argv);
  const suite = buildEvalSuite(flags.seedTag);

  if (flags.dryRun) {
    out(`\n=== FB-Eval ${FB_EVAL_SUITE_VERSION} Self-Test (seed: ${flags.seedTag}) ===`);
    let passed = 0;
    for (const prompt of suite) {
      const res = await prompt.grade(prompt.referenceAnswer);
      if (res.passed) passed += 1;
      out(
        `  ${res.passed ? 'PASS' : 'FAIL'} [${prompt.pillar.padEnd(9)}] ${prompt.id.padEnd(26)} | ${res.detail}`
      );
    }
    out(`\nResult: ${passed}/${suite.length} reference solutions passed.`);
    if (passed !== suite.length) {
      process.exitCode = 1;
    }
    return;
  }

  const models = await fetchLiveModels();
  const targets: Array<{ model: LeaderboardModel; offering: ProviderOffering }> = [];

  if (flags.modelFilter) {
    const found = models.find((m) => m.canonical_id === flags.modelFilter);
    if (!found) {
      throw new Error(`Model '${flags.modelFilter}' not found in live catalog`);
    }
    const offering = pickBestOffering(found.providers, flags.providerFilter);
    if (!offering) {
      throw new Error(`No eligible Direct API credentials for '${flags.modelFilter}'`);
    }
    targets.push({ model: found, offering });
  } else if (flags.calibrate) {
    targets.push(...selectStratifiedAnchors(models, flags.limit ?? 8, flags.providerFilter));
  } else {
    const maxTargets = flags.limit ?? 3;
    for (const m of models) {
      if (m.freebench_score != null || m.fb_eval_score != null) continue;
      const offering = pickBestOffering(m.providers, flags.providerFilter);
      if (!offering) continue;
      targets.push({ model: m, offering });
      if (targets.length >= maxTargets) break;
    }
  }

  if (targets.length === 0) {
    out('No eligible models matched the criteria/credentials.');
    return;
  }

  out(
    `\nRunning FB-Eval ${FB_EVAL_SUITE_VERSION} (seed=${flags.seedTag}, prompts=${suite.length}) on ${targets.length} model(s)...\n`
  );

  const summaries: ModelEvalSummary[] = [];
  const anchorPairs: Array<{
    canonicalId: string;
    freebenchScore: number;
    evalSummary: ModelEvalSummary;
  }> = [];

  for (const { model, offering } of targets) {
    out(
      `-> Evaluating ${model.canonical_id} via ${offering.provider_slug}:${offering.provider_model_id}...`
    );
    const summary = await evaluateModel(
      {
        canonical_id: model.canonical_id,
        provider_slug: offering.provider_slug,
        provider_model_id: offering.provider_model_id,
      },
      suite,
      { seedTag: flags.seedTag, delayMs: flags.delayMs }
    );

    if (summary.aborted) {
      out(`   ABORTED (${summary.abortReason ?? 'provider error'})`);
      continue;
    }

    summaries.push(summary);

    if (typeof model.freebench_score === 'number') {
      anchorPairs.push({
        canonicalId: model.canonical_id,
        freebenchScore: model.freebench_score,
        evalSummary: summary,
      });
    }

    out(
      `   Score: ${summary.overallScore.toFixed(1)} (${summary.passedCount}/${summary.totalCount}) | Code ${summary.pillarScores.coding.toFixed(0)} · Tools ${summary.pillarScores.tools.toFixed(0)} · IFEval ${summary.pillarScores.if.toFixed(0)} · Logic ${summary.pillarScores.reasoning.toFixed(0)} | avg=${summary.avgLatencyMs ?? '-'}ms`
    );
  }

  if (flags.calibrate && anchorPairs.length >= 2) {
    const report = buildCalibrationReport(anchorPairs);
    out('\n=== Anchor Calibration Report ===');
    out(
      `Anchors: ${report.anchorCount} | Spearman rho: ${report.spearmanRho ?? 'n/a'} | Pearson r: ${report.pearsonR ?? 'n/a'}`
    );
    for (const a of report.anchors) {
      out(
        `  ${a.canonicalId.padEnd(28)} FreeBench=${a.freebenchScore.toFixed(1)} | FB-Eval=${a.evalScore.toFixed(1)} (${a.passedCount}/${a.totalCount})`
      );
    }
  }

  if (flags.write) {
    await persistEvalSummaries(summaries);
    out(`\nPersisted ${summaries.length} FB-Eval result(s) to Supabase.`);
  } else {
    out('\nDry/local mode: pass --write to persist results to Supabase.');
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`FB-Eval failed: ${msg}\n`);
  process.exitCode = 1;
});
