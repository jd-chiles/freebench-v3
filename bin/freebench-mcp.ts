#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { handleMcpRequest } from '../lib/mcp/server';
import type { LeaderboardModel } from '../lib/supabase/types';

function loadOfflineModels(): LeaderboardModel[] {
  const seedUrl = new URL('../data/seed-snapshot.json', import.meta.url);
  const parsed = JSON.parse(readFileSync(seedUrl, 'utf8')) as { models: LeaderboardModel[] };
  return parsed.models;
}

async function getLiveOrSeedModels(): Promise<LeaderboardModel[]> {
  const baseUrl = (process.env.FREEBENCH_API_URL?.trim() || 'https://freebench.org').replace(
    /\/$/,
    ''
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${baseUrl}/api/v1/models`, { signal: controller.signal });
    if (res.ok) {
      const payload = (await res.json()) as { models?: LeaderboardModel[] };
      if (Array.isArray(payload.models) && payload.models.length > 0) {
        return payload.models;
      }
    }
  } catch {
    // Offline fallback
  } finally {
    clearTimeout(timeout);
  }
  return loadOfflineModels();
}

async function main(): Promise<void> {
  const models = await getLiveOrSeedModels();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const response = handleMcpRequest(parsed, models);
      if (response !== null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`
      );
    }
  });
}

main().catch((err) => {
  process.stderr.write(`freebench-mcp error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
