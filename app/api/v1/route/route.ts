import { NextResponse } from 'next/server';
import { CORS_HEADERS, selectBestRoute } from '@/lib/api/router';
import { getLeaderboardData } from '@/lib/data/queries';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const { models } = await getLeaderboardData();
  const params = new URL(request.url).searchParams;
  const selection = selectBestRoute(models, params);

  if (!selection.recommended) {
    return NextResponse.json(
      { error: 'No free model matches your routing constraints', ...selection },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(selection, {
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
    },
  });
}
