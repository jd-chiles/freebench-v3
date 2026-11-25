import { filterModelsForTask, getLeaderboardData, TASK_DEFINITIONS } from '@/lib/data/queries';
import { formatContextWindow, formatScore } from '@/lib/format';
import { sortProviderOfferings } from '@/lib/providers/limits';
import { getProvidersConfig } from '@/lib/providers/types';
import { getSiteUrl } from '@/lib/site';

export const revalidate = 21600;

export async function GET() {
  const siteUrl = getSiteUrl();
  const { models, latestSync } = await getLeaderboardData();
  const providersConfig = getProvidersConfig();
  const providerCount = Object.keys(providersConfig).length;

  const lines: string[] = [
    '# FreeBench v0.0.1',
    `> Live leaderboard pairing verified free-tier LLM API availability across ${providerCount} providers with Epoch AI ECI, LiveBench, BFCL, Aider Polyglot, and SWE-bench Verified benchmarks.`,
    '',
    `Last synced: ${latestSync?.completed_at ?? latestSync?.started_at ?? 'snapshot'}`,
    `Full Leaderboard: ${siteUrl}/`,
    `Fallback Stack Builder: ${siteUrl}/stack`,
    `JSON Models API (filterable): ${siteUrl}/api/v1/models?task=agentic-coding&always_free=1&zero_training=1`,
    `Agent Router API: ${siteUrl}/api/v1/route?task=agentic-coding&always_free=1&zero_training=1`,
    `RSS Feed (supports ?provider=, ?model=, ?type=drops): ${siteUrl}/feed.xml`,
    '',
    '## CLI & MCP Usage',
    '- CLI route check: `npx freebench route agentic-coding --always-free --json`',
    '- Local stdio MCP server: `npx freebench-mcp` (tools: `get_best_free_model`, `get_free_fallback_stack`)',
    '',
    '## Current #1 Free LLMs By Task',
  ];

  for (const task of TASK_DEFINITIONS) {
    const top = filterModelsForTask(models, task.slug)[0];
    if (!top) continue;
    const providers = sortProviderOfferings(top.providers)
      .map((p) => p.provider_slug)
      .join(', ');
    lines.push(
      `- ${task.shortLabel}: ${top.display_name} (Composite ${formatScore(
        top.freebench_score
      )}, Context ${formatContextWindow(top.context_window)}, Free on: ${providers}) -> ${siteUrl}/best/${task.slug}`
    );
  }

  lines.push('', `## Provider Connection Reference (${providerCount} Free Providers)`);
  for (const [slug, cfg] of Object.entries(providersConfig)) {
    lines.push(
      `- ${slug} (${cfg.display_name}): base_url=${cfg.api_base_url} | env=${cfg.env_var} | tier=${cfg.tier_type} | openai_compatible=${cfg.openai_compatible} | trains_on_data=${cfg.trains_on_data} | limits=${cfg.rpm_limit}, ${cfg.rpd_limit}`
    );
  }

  lines.push('', '## Top 10 Free Models Overall');
  for (const [idx, model] of models.slice(0, 10).entries()) {
    const providers = sortProviderOfferings(model.providers)
      .map((p) => `${p.provider_slug}:${p.provider_model_id}`)
      .join(' | ');
    lines.push(
      `${idx + 1}. ${model.display_name} — Composite ${formatScore(
        model.freebench_score
      )}, Agentic ${formatScore(model.agentic_coding_score)}, Context ${formatContextWindow(
        model.context_window
      )} [${providers}]`
    );
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=3600',
    },
  });
}
