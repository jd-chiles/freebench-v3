#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { filterApiModels, selectBestRoute } from '../lib/api/router';
import type { LeaderboardModel } from '../lib/supabase/types';

function loadOfflineModels(): LeaderboardModel[] {
  const seedUrl = new URL('../data/seed-snapshot.json', import.meta.url);
  const parsed = JSON.parse(readFileSync(seedUrl, 'utf8')) as { models: LeaderboardModel[] };
  return parsed.models;
}

async function loadModels(offline: boolean): Promise<{ models: LeaderboardModel[]; source: string }> {
  if (offline) {
    return { models: loadOfflineModels(), source: 'seed-snapshot' };
  }

  const baseUrl = (process.env.FREEBENCH_API_URL?.trim() || 'https://freebench.org').replace(
    /\/$/,
    ''
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${baseUrl}/api/v1/models`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { models?: LeaderboardModel[] };
    if (Array.isArray(payload.models) && payload.models.length > 0) {
      return { models: payload.models, source: baseUrl };
    }
  } catch {
    // Fall back to local snapshot when offline or remote unreachable.
  } finally {
    clearTimeout(timeout);
  }

  return { models: loadOfflineModels(), source: 'seed-snapshot' };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let command: 'best' | 'route' = 'route';
  let task = 'agentic-coding';
  let jsonOutput = false;
  let offline = false;
  const search = new URLSearchParams();

  for (const arg of args) {
    if (arg === 'best' || arg === 'route') {
      command = arg;
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--offline') {
      offline = true;
    } else if (arg === '--always-free') {
      search.set('always_free', '1');
    } else if (arg === '--direct-api') {
      search.set('direct_api', '1');
    } else if (arg === '--zero-training') {
      search.set('zero_training', '1');
    } else if (arg.startsWith('--provider=')) {
      search.set('provider', arg.slice('--provider='.length));
    } else if (arg.startsWith('--min-context=')) {
      search.set('min_context', arg.slice('--min-context='.length));
    } else if (arg.startsWith('--limit=')) {
      search.set('limit', arg.slice('--limit='.length));
    } else if (!arg.startsWith('--')) {
      task = arg;
    }
  }

  search.set('task', task);
  const { models, source } = await loadModels(offline);

  if (command === 'route') {
    const route = selectBestRoute(models, search);
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify({ source, ...route }, null, 2)}\n`);
      return;
    }

    if (!route.recommended) {
      process.stdout.write(`No free model matched task="${task}".\n`);
      process.exitCode = 1;
      return;
    }

    const r = route.recommended;
    process.stdout.write(
      `Recommended (${task}, via ${source}):\n  ${r.display_name} -> ${r.provider_slug}:${r.provider_model_id}\n  Base URL: ${r.base_url}\n  Env Var:  ${r.env_var}\n  Limits:   ${r.rpm_limit} | ${r.rpd_limit} | ${r.session_viability}\n`
    );
    if (route.fallbacks.length > 0) {
      process.stdout.write('\nFallbacks:\n');
      for (const fb of route.fallbacks) {
        process.stdout.write(
          `  - ${fb.display_name} -> ${fb.provider_slug}:${fb.provider_model_id} (${fb.rpm_limit})\n`
        );
      }
    }
    return;
  }

  if (!search.has('limit')) search.set('limit', '10');
  const ranked = filterApiModels(models, search);
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ source, task, count: ranked.length, models: ranked }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Top Free Models for ${task} (${source}):\n`);
  for (const [idx, m] of ranked.entries()) {
    const p = m.providers[0];
    process.stdout.write(
      `  ${idx + 1}. ${m.display_name} | score=${m.freebench_score ?? '-'} | ${p?.provider_slug}:${p?.provider_model_id}\n`
    );
  }
}

main().catch((err) => {
  process.stderr.write(`freebench CLI error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
