export function formatContextWindow(tokens: number | null | undefined): string {
  if (!tokens || tokens <= 0) return '—';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}

export function formatScore(score: number | null | undefined, digits: number = 1): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return score.toFixed(digits);
}

export function formatRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Unknown';
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return 'Unknown';
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
