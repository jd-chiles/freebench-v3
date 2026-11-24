import { NextResponse } from 'next/server';
import { CORS_HEADERS, filterApiModels } from '@/lib/api/router';
import { getLeaderboardData } from '@/lib/data/queries';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const { models, latestSync, isDemoData } = await getLeaderboardData();
  const params = new URL(request.url).searchParams;
  const filtered = filterApiModels(models, params);

  return NextResponse.json(
    {
      version: '0.0.1',
      synced_at: latestSync?.completed_at ?? latestSync?.started_at ?? null,
      is_demo_data: isDemoData,
      count: filtered.length,
      models: filtered,
    },
    {
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    }
  );
}
