'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

export function CopyButton({ text, label, className = '' }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 1600);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label ?? text}`}
      className={`inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 ${className}`}
    >
      {state === 'copied' ? (
        <>
          <Check className="h-3 w-3 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : state === 'error' ? (
        <span className="text-rose-400">Copy failed</span>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          {label ? <span>{label}</span> : null}
        </>
      )}
    </button>
  );
}
