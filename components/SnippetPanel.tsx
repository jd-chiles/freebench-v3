'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Terminal,
} from 'lucide-react';
import { EndpointHealthBadge } from '@/components/EndpointHealthBadge';
import { trackEvent } from '@/lib/analytics/track';
import { getProvidersConfig } from '@/lib/providers/types';
import { generateProviderSnippets, type SnippetTab } from '@/lib/snippets/generator';
import type { ProviderOffering } from '@/lib/supabase/types';

interface SnippetPanelProps {
  providers: ProviderOffering[];
  canonicalId: string;
}

const STORAGE_KEY = 'freebench:snippet-tab';

function sortOfferingsForQuickConnect(offerings: ProviderOffering[]): ProviderOffering[] {
  return [...offerings].sort((a, b) => {
    const aScore = (a.tier_type === 'trial_credit' ? 2 : 0) + (a.trains_on_data ? 1 : 0);
    const bScore = (b.tier_type === 'trial_credit' ? 2 : 0) + (b.trains_on_data ? 1 : 0);
    if (aScore !== bScore) return aScore - bScore;
    return a.provider_slug.localeCompare(b.provider_slug);
  });
}

function offeringKey(o: ProviderOffering): string {
  return `${o.provider_slug}:${o.provider_model_id}`;
}

export function SnippetPanel({ providers, canonicalId }: SnippetPanelProps) {
  const sortedProviders = useMemo(() => sortOfferingsForQuickConnect(providers), [providers]);
  const [selectedKey, setSelectedKey] = useState<string>(() =>
    sortedProviders[0] ? offeringKey(sortedProviders[0]) : ''
  );
  const [activeTabId, setActiveTabId] = useState<SnippetTab['id']>('opencode');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [report429State, setReport429State] = useState<'idle' | 'sending' | 'reported' | 'error'>(
    'idle'
  );
  const [pingOpen, setPingOpen] = useState(false);
  const [byokKey, setByokKey] = useState('');
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as SnippetTab['id'] | null;
      if (saved) {
        setActiveTabId(saved);
      }
    } catch {
      // Ignore storage access errors in private browsing.
    }
  }, []);

  useEffect(() => {
    const first = sortedProviders[0];
    if (!first) {
      setSelectedKey('');
      return;
    }
    if (!sortedProviders.some((p) => offeringKey(p) === selectedKey)) {
      setSelectedKey(offeringKey(first));
    }
    setReport429State('idle');
    setPingResult(null);
  }, [canonicalId, sortedProviders, selectedKey]);

  const activeProvider =
    sortedProviders.find((p) => offeringKey(p) === selectedKey) ?? sortedProviders[0];

  const tabs = useMemo(() => {
    if (!activeProvider) return [];
    return generateProviderSnippets(
      activeProvider.provider_slug,
      activeProvider.provider_model_id
    );
  }, [activeProvider]);

  if (!activeProvider) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-xs text-zinc-400">
        No active free providers available for this filter.
      </div>
    );
  }

  const providersConfig = getProvidersConfig();
  const activeConfig = providersConfig[activeProvider.provider_slug];
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const agentTabs = tabs.filter((t) => t.group === 'agent');
  const sdkTabs = tabs.filter((t) => t.group === 'sdk');

  function handleSelectTab(tabId: SnippetTab['id']) {
    setActiveTabId(tabId);
    try {
      window.localStorage.setItem(STORAGE_KEY, tabId);
    } catch {
      // Ignore storage errors.
    }
  }

  async function handleCopy() {
    if (!activeTab || !activeProvider) return;
    try {
      await navigator.clipboard.writeText(activeTab.code);
      setCopyState('copied');
      trackEvent('copy_api_snippet', {
        provider: activeProvider.provider_slug,
        format: activeTab.id,
        model: canonicalId,
      });
      setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  }

  async function handleReport429() {
    if (!activeProvider || report429State === 'sending' || report429State === 'reported') return;
    setReport429State('sending');
    try {
      const response = await fetch('/api/v1/report-429', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_slug: activeProvider.provider_slug,
          provider_model_id: activeProvider.provider_model_id,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReport429State('reported');
    } catch {
      setReport429State('error');
      setTimeout(() => setReport429State('idle'), 2000);
    }
  }

  async function handleLivePing() {
    if (!activeProvider || pinging) return;
    if (activeProvider.provider_slug === 'cloudflare') {
      setPingResult({
        ok: false,
        message: 'Cloudflare Workers AI blocks browser CORS; test via cURL or CLI.',
      });
      return;
    }

    const trimmedKey = byokKey.trim();
    if (activeProvider.provider_slug !== 'pollinations' && !trimmedKey) {
      setPingResult({
        ok: false,
        message: `Paste your ${activeConfig.env_var} first (stays in-browser only).`,
      });
      return;
    }

    setPinging(true);
    setPingResult(null);
    const startedAt = Date.now();

    try {
      let url = `${activeConfig.api_base_url.replace(/\/$/, '')}/chat/completions`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body: unknown = {
        model: activeProvider.provider_model_id,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 4,
      };

      if (activeProvider.provider_slug === 'google') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          activeProvider.provider_model_id
        )}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
        body = {
          contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
          generationConfig: { maxOutputTokens: 4 },
        };
      } else if (activeProvider.provider_slug !== 'pollinations') {
        headers.Authorization = `Bearer ${trimmedKey}`;
        if (activeProvider.provider_slug === 'openrouter') {
          headers['HTTP-Referer'] = window.location.origin;
          headers['X-Title'] = 'FreeBench';
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const elapsedMs = Date.now() - startedAt;

      setPingResult({
        ok: response.ok,
        message: response.ok
          ? `HTTP ${response.status} OK in ${elapsedMs}ms`
          : `HTTP ${response.status} ${response.statusText} (${elapsedMs}ms)`,
      });
    } catch {
      setPingResult({
        ok: false,
        message:
          'Browser request blocked by provider CORS policy or network error; use cURL/OpenCode snippet.',
      });
    } finally {
      setPinging(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <span>Quick-Connect Snippets & Agent Configs</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleReport429}
            disabled={report429State === 'sending' || report429State === 'reported'}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
              report429State === 'reported'
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-amber-500/50 hover:text-amber-300'
            }`}
            title="Report live HTTP 429 rate-limit pressure on this endpoint"
          >
            <AlertTriangle className="h-3 w-3" />
            <span>
              {report429State === 'reported'
                ? '429 Reported'
                : report429State === 'sending'
                  ? 'Reporting...'
                  : report429State === 'error'
                    ? 'Report failed'
                    : 'Hit 429?'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setPingOpen((prev) => !prev)}
            aria-expanded={pingOpen}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-300 hover:border-cyan-500/50 hover:text-cyan-300"
          >
            <Activity className="h-3 w-3" />
            <span>Live Ping (BYOK)</span>
          </button>

          <a
            href={`/go/${activeProvider.provider_slug}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackEvent('outbound_provider_click', {
                provider: activeProvider.provider_slug,
                model: canonicalId,
              })
            }
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25"
          >
            <span>Get Free API Key</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Provider selector pills sorted Always-Free + Zero-Training first */}
      <div className="flex flex-wrap gap-1.5">
        {sortedProviders.map((provider) => {
          const cfg = providersConfig[provider.provider_slug];
          const key = offeringKey(provider);
          const isSelected = key === offeringKey(activeProvider);
          const isTrial = provider.tier_type === 'trial_credit';
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setSelectedKey(key);
                setReport429State('idle');
                setPingResult(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                isSelected
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                  : isTrial
                    ? 'border-dashed border-amber-500/40 bg-zinc-950 text-amber-200/80 hover:border-amber-400'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              <span>{cfg.display_name.replace(' (Free)', '')}</span>
              {isTrial ? (
                <span className="text-[9px] uppercase text-amber-400">Credit</span>
              ) : null}
              {provider.trains_on_data ? (
                <span className="text-[9px] uppercase text-rose-400">Trains</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Active offering metadata strip + health telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800/80 bg-zinc-950/70 px-3 py-1.5 font-mono text-[11px] text-zinc-400">
        <span className="truncate text-zinc-200">{activeProvider.provider_model_id}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {activeConfig.display_name} · {activeProvider.rpm_limit} · {activeProvider.rpd_limit}
          </span>
          <EndpointHealthBadge offering={activeProvider} />
        </div>
      </div>

      {activeConfig.access_mode === 'harness_only' ? (
        <div className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
          <strong>Harness-Only Free Tier:</strong> Free access requires{' '}
          <strong className="text-violet-100">
            {activeConfig.harness_name ?? activeConfig.display_name}
          </strong>
          . Use a Direct API provider (OpenRouter, Groq, Google, etc.) for standalone apps.
        </div>
      ) : null}

      {/* Collapsible Live BYOK Ping Tester */}
      {pingOpen ? (
        <div className="space-y-2 rounded-md border border-cyan-500/30 bg-zinc-950/80 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-300">
              Runs directly from your browser to {activeConfig.display_name}. Your key is never
              sent to FreeBench servers.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeProvider.provider_slug !== 'pollinations' ? (
              <input
                type="password"
                value={byokKey}
                onChange={(e) => setByokKey(e.target.value)}
                placeholder={`Paste ${activeConfig.env_var}...`}
                aria-label="API key for browser ping"
                className="min-w-[200px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 font-mono text-xs text-zinc-100 placeholder-zinc-500"
              />
            ) : (
              <span className="font-mono text-xs text-emerald-300">
                Anonymous zero-key ping ready
              </span>
            )}
            <button
              type="button"
              onClick={handleLivePing}
              disabled={pinging}
              className="rounded border border-cyan-500/50 bg-cyan-500/15 px-3 py-1 font-mono text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
            >
              {pinging ? 'Pinging...' : 'Run 4-Token Ping'}
            </button>
          </div>
          {pingResult ? (
            <div
              className={`font-mono text-[11px] ${
                pingResult.ok ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {pingResult.message}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Tab switcher: Coding Agents & API SDKs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            Agents:
          </span>
          {agentTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSelectTab(tab.id)}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                activeTab?.id === tab.id
                  ? 'bg-zinc-800 text-emerald-300'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <span className="mx-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            SDKs:
          </span>
          {sdkTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSelectTab(tab.id)}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                activeTab?.id === tab.id
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
        >
          {copyState === 'copied' ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : copyState === 'error' ? (
            <span className="text-rose-400">Copy failed</span>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">
        <code>{activeTab?.code ?? ''}</code>
      </pre>
    </div>
  );
}
