'use client';

import { useState, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { Check, Mail } from 'lucide-react';
import { trackEvent } from '@/lib/analytics/track';

export function NewsletterSignup() {
  const pathname = usePathname();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;

    setStatus('submitting');
    setMessage('');

    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), sourcePath: pathname }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Subscription failed');
      }

      setStatus('done');
      setMessage('Subscribed to the weekly Free LLM Radar.');
      setEmail('');
      trackEvent('newsletter_subscribed', { source_path: pathname });
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unable to subscribe right now.');
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-200">
        <Mail className="h-3.5 w-3.5 text-emerald-400" />
        <span>Weekly Free LLM Radar</span>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        New zero-cost model drops, deprecated endpoints, and rank changes every week.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="dev@company.com"
          aria-label="Email address"
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={status === 'submitting' || status === 'done'}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
        >
          {status === 'done' ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>Joined</span>
            </>
          ) : status === 'submitting' ? (
            'Joining...'
          ) : (
            'Subscribe'
          )}
        </button>
      </form>
      {message ? (
        <p
          className={`mt-2 text-[11px] ${
            status === 'error' ? 'text-rose-400' : 'text-emerald-400'
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
