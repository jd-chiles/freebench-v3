import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  buildKeyStatusRows,
  maskSecret,
  parseEnvFile,
  PROVIDER_KEY_SPECS,
  upsertEnvFileContent,
  validateProviderKeyLive,
  type KeyTier,
} from '@/lib/keys/manager';
import { getProvidersConfig, type ProviderSlug } from '@/lib/providers/types';

interface ParsedArgs {
  command: 'wizard' | 'status' | 'push';
  repo: string;
  tierFilter: KeyTier | null;
  providerFilter: ProviderSlug | null;
  includeConfigured: boolean;
  noOpen: boolean;
  noPush: boolean;
  noSync: boolean;
}

const DEFAULT_REPO = 'jd-chiles/freebench-v3';
const ENV_LOCAL_PATH = path.resolve(process.cwd(), '.env.local');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function detectGitHubRepo(): string {
  const gitRes = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (gitRes.status === 0 && gitRes.stdout) {
    const raw = gitRes.stdout.trim();
    const match = raw.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return DEFAULT_REPO;
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command: ParsedArgs['command'] = 'wizard';
  let repo = '';
  let tierFilter: KeyTier | null = null;
  let providerFilter: ProviderSlug | null = null;
  let includeConfigured = false;
  let noOpen = false;
  let noPush = false;
  let noSync = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (i === 0 && (arg === 'status' || arg === 'push' || arg === 'wizard')) {
      command = arg;
      continue;
    }
    if (arg === '--all') {
      includeConfigured = true;
    } else if (arg === '--no-open') {
      noOpen = true;
    } else if (arg === '--no-push') {
      noPush = true;
    } else if (arg === '--no-sync') {
      noSync = true;
    } else if (arg.startsWith('--repo=')) {
      repo = arg.slice('--repo='.length).trim();
    } else if (arg === '--repo' && args[i + 1]) {
      repo = args[i + 1]!.trim();
      i += 1;
    } else if (arg.startsWith('--tier=')) {
      const n = Number(arg.slice('--tier='.length));
      if (n === 1 || n === 2 || n === 3) tierFilter = n;
    } else if (arg === '--tier' && args[i + 1]) {
      const n = Number(args[i + 1]);
      if (n === 1 || n === 2 || n === 3) tierFilter = n;
      i += 1;
    } else if (arg.startsWith('--provider=')) {
      providerFilter = arg.slice('--provider='.length).trim() as ProviderSlug;
    } else if (arg === '--provider' && args[i + 1]) {
      providerFilter = args[i + 1]!.trim() as ProviderSlug;
      i += 1;
    }
  }

  return {
    command,
    repo: repo || detectGitHubRepo(),
    tierFilter,
    providerFilter,
    includeConfigured,
    noOpen,
    noPush,
    noSync,
  };
}

function readLocalEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_LOCAL_PATH)) {
    return {};
  }
  return parseEnvFile(fs.readFileSync(ENV_LOCAL_PATH, 'utf8'));
}

function writeLocalEnvUpdates(updates: Record<string, string>): void {
  const existing = fs.existsSync(ENV_LOCAL_PATH) ? fs.readFileSync(ENV_LOCAL_PATH, 'utf8') : '';
  const next = upsertEnvFileContent(existing, updates);
  fs.writeFileSync(ENV_LOCAL_PATH, next, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(ENV_LOCAL_PATH, 0o600);
  } catch {
    // chmod is a no-op on Windows NTFS
  }
}

function fetchGitHubSecretNames(repo: string): {
  ok: boolean;
  names: Set<string>;
  error?: string;
} {
  const res = spawnSync('gh', ['secret', 'list', '--repo', repo, '--json', 'name'], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    const errText = (res.stderr || res.stdout || 'gh secret list failed').trim();
    return { ok: false, names: new Set(), error: errText };
  }

  try {
    const parsed = JSON.parse(res.stdout) as Array<{ name: string }>;
    return { ok: true, names: new Set(parsed.map((item) => item.name)) };
  } catch (error) {
    return {
      ok: false,
      names: new Set(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pushSecretsToGitHub(
  repo: string,
  entries: Array<[string, string]>,
  triggerSync: boolean
): void {
  if (entries.length === 0) {
    out('No provider keys found to push.');
    return;
  }

  out(`\nSyncing ${entries.length} secret(s) to GitHub Actions (${repo}) via stdin...`);
  let uploadedCount = 0;

  for (const [envVar, value] of entries) {
    const res = spawnSync('gh', ['secret', 'set', envVar, '--repo', repo], {
      input: value,
      encoding: 'utf8',
    });
    if (res.status === 0) {
      uploadedCount += 1;
      out(`  ✓ ${envVar} (${maskSecret(value)})`);
    } else {
      const msg = (res.stderr || res.stdout || `exit ${res.status}`).trim();
      out(`  ✗ ${envVar}: ${msg}`);
    }
  }

  if (uploadedCount > 0 && triggerSync) {
    out(`\nDispatching sync.yml on ${repo}...`);
    const runRes = spawnSync('gh', ['workflow', 'run', 'sync.yml', '--repo', repo], {
      encoding: 'utf8',
    });
    if (runRes.status === 0) {
      out('  ✓ sync.yml workflow dispatched cleanly.');
    } else {
      out(`  ✗ Failed dispatching sync.yml: ${(runRes.stderr || runRes.stdout).trim()}`);
    }
  }
}

function runStatusCommand(repo: string): void {
  const localEnv = readLocalEnvFile();
  const gh = fetchGitHubSecretNames(repo);
  const rows = buildKeyStatusRows(localEnv, gh.names);

  out(`\nFreeBench API Key Status (repo: ${repo})\n`);
  if (!gh.ok) {
    out(`! Could not read GitHub secrets (${gh.error ?? 'gh unavailable'}). Showing .env.local only.\n`);
  }

  const header = [
    'Provider'.padEnd(22),
    'Tier'.padEnd(6),
    'Catalog'.padEnd(8),
    'Env Var(s)'.padEnd(42),
    'Local'.padEnd(7),
    'GitHub'.padEnd(7),
    'Preview',
  ].join(' | ');
  out(header);
  out('-'.repeat(header.length));

  let keyedConfiguredGh = 0;
  let keyedTotal = 0;
  let keylessCount = 0;

  for (const row of rows) {
    if (row.catalogMode === 'keyless') keylessCount += 1;
    if (row.envVars.length > 0 && row.catalogMode === 'keyed') {
      keyedTotal += 1;
      if (row.githubPresent) keyedConfiguredGh += 1;
    }

    const tierLabel = row.tier === 0 ? '-' : `T${row.tier}`;
    const catalogLabel = row.catalogMode === 'keyless' ? 'Keyless' : 'Keyed';
    const envLabel = row.envVars.length === 0 ? '(none required)' : row.envVars.join(', ');
    const localLabel = row.envVars.length === 0 ? 'n/a' : row.localPresent ? 'yes' : 'no';
    const ghLabel = !gh.ok
      ? '?'
      : row.envVars.length === 0
        ? 'n/a'
        : row.githubPresent
          ? 'yes'
          : 'no';
    const preview =
      Object.values(row.maskedLocalValues).join(', ') || (row.note ? row.note : '-');

    out(
      [
        row.displayName.slice(0, 22).padEnd(22),
        tierLabel.padEnd(6),
        catalogLabel.padEnd(8),
        envLabel.slice(0, 42).padEnd(42),
        localLabel.padEnd(7),
        ghLabel.padEnd(7),
        preview,
      ].join(' | ')
    );
  }

  const pendingPushCount = rows.filter(
    (r) => r.envVars.length > 0 && r.localPresent && (!gh.ok || !r.githubPresent)
  ).length;

  out(
    `\nSummary: ${keylessCount} keyless catalogs active | ${keyedConfiguredGh}/${keyedTotal} keyed catalogs configured in GitHub`
  );
  if (pendingPushCount > 0) {
    out(`Next: run \`npm run keys:push\` to sync ${pendingPushCount} local provider key(s) to GitHub Actions.`);
  } else {
    out('Next: run `npm run keys:wizard` to configure any missing provider keys.');
  }
}

function runPushCommand(repo: string, noSync: boolean): void {
  const localEnv = readLocalEnvFile();
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const spec of PROVIDER_KEY_SPECS) {
    for (const envVar of spec.envVars) {
      if (seen.has(envVar)) continue;
      seen.add(envVar);
      const val = localEnv[envVar]?.trim();
      if (val) {
        entries.push([envVar, val]);
      }
    }
  }

  pushSecretsToGitHub(repo, entries, !noSync);
}

function openBrowserUrl(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Non-fatal: signup URL is also printed in terminal output.
  }
}

function promptLine(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptMaskedInput(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return promptLine(label);
  }

  return new Promise((resolve) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let buffer = '';

    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };

    const onData = (chunk: Buffer): void => {
      const str = chunk.toString('utf8');
      for (const ch of str) {
        if (ch === '\u0003') {
          process.stdout.write('^C\n');
          cleanup();
          process.exit(130);
        } else if (ch === '\r' || ch === '\n') {
          process.stdout.write('\n');
          cleanup();
          resolve(buffer.trim());
          return;
        } else if (ch === '\u007f' || ch === '\b') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          buffer += ch;
          process.stdout.write('*');
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function runWizardCommand(args: ParsedArgs): Promise<void> {
  const providersConfig = getProvidersConfig();
  const localEnv = readLocalEnvFile();
  const gh = fetchGitHubSecretNames(args.repo);
  const allEnvPairsToPush: Array<[string, string]> = [];
  let savedCount = 0;

  const queue = PROVIDER_KEY_SPECS.filter((spec) => {
    if (args.providerFilter && spec.slug !== args.providerFilter) return false;
    if (args.tierFilter && spec.tier !== args.tierFilter) return false;
    if (args.includeConfigured || args.providerFilter) return true;

    const hasAllLocal = spec.envVars.every((v) => Boolean(localEnv[v]?.trim()));
    const hasAllGh = gh.ok && spec.envVars.every((v) => gh.names.has(v));
    return !(hasAllLocal && hasAllGh);
  });

  if (queue.length === 0) {
    out('All matching provider keys are already configured locally and in GitHub Secrets.');
    out('Run `npm run keys:status` to inspect or pass `--all` to reconfigure.');
    return;
  }

  out(`\nFreeBench Interactive Key Wizard (${queue.length} provider(s))`);
  const opsEmail = localEnv.FREEBENCH_OPS_EMAIL?.trim();
  if (opsEmail) {
    const gmailMatch = opsEmail.match(/^([^+@]+)@gmail\.com$/i);
    const aliasTip = gmailMatch?.[1] ? ` (Gmail alias tip: ${gmailMatch[1]}+freebench@gmail.com)` : '';
    out(`Ops email: ${opsEmail}${aliasTip}`);
  }
  out('Tip: Press Enter at any prompt to skip a provider.\n');

  for (const spec of queue) {
    const cfg = providersConfig[spec.slug];
    out(`=== Tier ${spec.tier}: ${cfg.display_name} (${spec.slug}) ===`);
    if (cfg.tier_note) out(`Tier: ${cfg.tier_note}`);
    if (spec.note) out(`Note: ${spec.note}`);
    out(`URL : ${cfg.signup_url}`);

    if (!args.noOpen) {
      openBrowserUrl(cfg.signup_url);
    }

    let doneProvider = false;
    while (!doneProvider) {
      const candidateUpdates: Record<string, string> = {};
      let skipped = false;

      for (const envVar of spec.envVars) {
        const existingHint = localEnv[envVar] ? ` [saved: ${maskSecret(localEnv[envVar]!)}]` : '';
        const entered = await promptMaskedInput(`Paste ${envVar}${existingHint} (Enter to skip): `);
        if (!entered) {
          skipped = true;
          break;
        }
        candidateUpdates[envVar] = entered;
      }

      if (skipped) {
        out(`Skipped ${cfg.display_name}.\n`);
        doneProvider = true;
        continue;
      }

      out(`Validating ${cfg.display_name}...`);
      const validation = await validateProviderKeyLive(spec.slug, candidateUpdates);
      if (validation.ok) {
        out(`  ✓ ${validation.message}`);
        writeLocalEnvUpdates(candidateUpdates);
        Object.assign(localEnv, candidateUpdates);
        for (const [k, v] of Object.entries(candidateUpdates)) {
          allEnvPairsToPush.push([k, v]);
        }
        savedCount += 1;
        out(`  Saved to .env.local.\n`);
        doneProvider = true;
      } else {
        out(`  ✗ ${validation.message}`);
        const choice = (
          await promptLine('Action: (r)etry, (s)kip, or (f)orce save anyway? [r/s/f]: ')
        ).toLowerCase();
        if (choice === 'f') {
          writeLocalEnvUpdates(candidateUpdates);
          Object.assign(localEnv, candidateUpdates);
          for (const [k, v] of Object.entries(candidateUpdates)) {
            allEnvPairsToPush.push([k, v]);
          }
          savedCount += 1;
          out('  Force-saved to .env.local.\n');
          doneProvider = true;
        } else if (choice !== 'r') {
          out(`Skipped ${cfg.display_name}.\n`);
          doneProvider = true;
        }
      }
    }
  }

  if (savedCount === 0) {
    out('No new keys saved.');
    return;
  }

  out(`Saved ${savedCount} provider configuration(s) to .env.local.`);
  if (args.noPush) {
    out('Skipped GitHub upload (--no-push). Run `npm run keys:push` when ready.');
    return;
  }

  const answer = (
    await promptLine('Sync saved keys to GitHub Actions Secrets & trigger sync.yml now? [Y/n]: ')
  ).toLowerCase();
  if (answer === '' || answer === 'y' || answer === 'yes') {
    pushSecretsToGitHub(args.repo, allEnvPairsToPush, !args.noSync);
  } else {
    out('Saved locally only. Run `npm run keys:push` when ready to push to GitHub.');
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);
  if (args.command === 'status') {
    runStatusCommand(args.repo);
    return;
  }
  if (args.command === 'push') {
    runPushCommand(args.repo, args.noSync);
    return;
  }
  await runWizardCommand(args);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Keys CLI error: ${msg}\n`);
  process.exitCode = 1;
});
