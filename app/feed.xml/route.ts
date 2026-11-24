import { getChangelogEvents, getPulsePageData } from '@/lib/data/queries';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(request: Request) {
  const siteUrl = (process.env.SITE_URL?.trim() || 'https://freebench.dev').replace(/\/$/, '');
  const params = new URL(request.url).searchParams;
  const providerFilter = params
    .get('provider')
    ?.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const modelFilter = params
    .get('model')
    ?.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const typeFilter = params.get('type')?.trim().toLowerCase() ?? 'all';

  const [{ events }, { items }] = await Promise.all([getChangelogEvents(), getPulsePageData()]);

  const filteredEvents = events.filter((evt) => {
    if (typeFilter === 'drops' && evt.event_type !== 'model_dropped' && evt.event_type !== 'quota_changed') {
      return false;
    }
    if (providerFilter && providerFilter.length > 0) {
      if (!evt.provider_slug || !providerFilter.includes(evt.provider_slug.toLowerCase())) {
        return false;
      }
    }
    if (modelFilter && modelFilter.length > 0) {
      if (!modelFilter.includes(evt.canonical_id.toLowerCase())) {
        return false;
      }
    }
    return true;
  });

  const includePulse =
    typeFilter !== 'drops' &&
    typeFilter !== 'events' &&
    (!providerFilter || providerFilter.length === 0) &&
    (!modelFilter || modelFilter.length === 0);

  const feedEntries = [
    ...filteredEvents.slice(0, 30).map((evt) => ({
      title: evt.headline,
      link: `${siteUrl}/models/${encodeURIComponent(evt.canonical_id)}`,
      guid: `event-${evt.id}-${evt.canonical_id}`,
      description: evt.summary_md.replace(/[*`]/g, ''),
      pubDate: new Date(evt.detected_at).toUTCString(),
    })),
    ...(includePulse
      ? items.slice(0, 20).map((item) => ({
          title: `[${item.source_name}] ${item.title}`,
          link: item.url,
          guid: `pulse-${item.url}`,
          description: item.summary ?? item.title,
          pubDate: new Date(item.published_at).toUTCString(),
        }))
      : []),
  ]
    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate))
    .slice(0, 35);

  const filterTags: string[] = [];
  if (typeFilter === 'drops') filterTags.push('Drops & Quotas');
  else if (typeFilter === 'events') filterTags.push('Events');
  if (providerFilter?.length) filterTags.push(`Providers: ${providerFilter.join(', ')}`);
  if (modelFilter?.length) filterTags.push(`Models: ${modelFilter.join(', ')}`);

  const channelTitle =
    filterTags.length > 0
      ? `FreeBench Radar (${filterTags.join(' | ')})`
      : 'FreeBench — Free LLM Radar & Model Pulse';

  const itemsXml = feedEntries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.link)}</link>
      <guid isPermaLink="false">${escapeXml(entry.guid)}</guid>
      <description>${escapeXml(entry.description)}</description>
      <pubDate>${entry.pubDate}</pubDate>
    </item>`
    )
    .join('\n');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>Automated feed of free-tier LLM launches, deprecations, quota updates, #1 rank changes, and agent releases.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`;

  return new Response(rssXml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
    },
  });
}
