'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Cpu, GitCompare, Layers, Radio, Sparkles, Terminal } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';

interface NavbarProps {
  isDemoData: boolean;
  latestSyncAt: string | null;
  latestStatus: 'running' | 'success' | 'partial' | 'failed' | null;
}

const NAV_LINKS = [
  { href: '/', label: 'Leaderboard', icon: Cpu },
  { href: '/best/agentic-coding', label: 'Agentic Coding', icon: Terminal },
  { href: '/stack', label: 'Stack Builder', icon: Layers },
  { href: '/compare', label: 'Compare', icon: GitCompare },
  { href: '/pulse', label: 'Model Pulse', icon: Radio },
  { href: '/changelog', label: 'Changelog', icon: Sparkles },
  { href: '/status', label: 'Sync Status', icon: Activity },
] as const;

export function Navbar({ isDemoData, latestSyncAt, latestStatus }: NavbarProps) {
  const pathname = usePathname();

  const badgeText = isDemoData
    ? 'Seed Snapshot'
    : latestStatus === 'partial'
      ? `Partial · ${formatRelativeTime(latestSyncAt)}`
      : latestStatus === 'failed'
        ? 'Sync Error'
        : `Live · ${formatRelativeTime(latestSyncAt)}`;

  const badgeStyle = isDemoData
    ? 'border-amber-500/35 bg-amber-500/10 text-amber-300 hover:border-amber-400/50'
    : latestStatus === 'failed'
      ? 'border-rose-500/35 bg-rose-500/10 text-rose-300 hover:border-rose-400/50'
      : latestStatus === 'partial'
        ? 'border-amber-500/35 bg-amber-500/10 text-amber-300 hover:border-amber-400/50'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400/50 hover:bg-emerald-500/15';

  const dotColor = isDemoData
    ? 'bg-amber-400'
    : latestStatus === 'failed'
      ? 'bg-rose-400'
      : latestStatus === 'partial'
        ? 'bg-amber-400'
        : 'bg-emerald-400';

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/15 font-mono text-xs font-bold text-emerald-400">
              FB
            </span>
            <span className="text-zinc-100">FreeBench</span>
            <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-400">
              v0.0.1
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV_LINKS.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-zinc-800 text-zinc-50'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/status"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${badgeStyle}`}
            title="View provider sync status and unmapped entity queue"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
            <span>{badgeText}</span>
          </Link>
        </div>
      </div>

      {/* Compact mobile nav */}
      <nav
        className="flex items-center gap-1 overflow-x-auto border-t border-zinc-900 px-4 py-1.5 md:hidden"
        aria-label="Mobile"
      >
        {NAV_LINKS.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${
                isActive ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
