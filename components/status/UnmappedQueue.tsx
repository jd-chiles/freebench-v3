'use client';

import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { UnmappedEntityRecord } from '@/lib/supabase/types';

interface UnmappedQueueProps {
  entities: UnmappedEntityRecord[];
}

export function UnmappedQueue({ entities }: UnmappedQueueProps) {
  const [originFilter, setOriginFilter] = useState<'all' | 'provider' | 'benchmark'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      originFilter === 'all'
        ? entities
        : entities.filter((e) => e.origin_type === originFilter),
    [entities, originFilter]
  );

  async function copyAliasSnippet(entity: UnmappedEntityRecord) {
    const slug = entity.suggested_canonical_id || 'new-model-slug';
    const snippet = JSON.stringify(
      {
        [slug]: {
          display_name: slug,
          family: 'Unknown',
          parameter_count: 'Unknown',
          is_open_weights: true,
          fallback_context_window: 131072,
          aliases: [entity.raw_id],
        },
      },
      null,
      2
    );

    await navigator.clipboard.writeText(snippet);
    const key = `${entity.origin_type}:${entity.source_slug}:${entity.raw_id}`;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-100">
          Unmapped Entities Review Queue ({filtered.length})
        </h2>
        <div className="flex gap-1.5">
          {(['all', 'provider', 'benchmark'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setOriginFilter(tab)}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
                originFilter === tab
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-xs text-zinc-400">
          All discovered provider and benchmark model IDs matched `config/aliases.json`.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full min-w-[700px] border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/70 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-4 py-3">Origin</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Raw ID</th>
                <th className="px-4 py-3">Suggested Slug</th>
                <th className="px-4 py-3">Seen</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {filtered.map((entity) => {
                const key = `${entity.origin_type}:${entity.source_slug}:${entity.raw_id}`;
                const isCopied = copiedKey === key;
                return (
                  <tr key={key}>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                      {entity.origin_type}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                      {entity.source_slug}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-100">{entity.raw_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-400">
                      {entity.suggested_canonical_id ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {entity.seen_count}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => copyAliasSnippet(entity)}
                        className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 font-mono text-[11px] text-zinc-200 hover:border-emerald-500/50"
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied JSON</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy Alias Entry</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
