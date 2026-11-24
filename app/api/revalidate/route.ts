import { timingSafeEqual } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TASK_DEFINITIONS } from '@/lib/data/queries';
import { getProvidersConfig } from '@/lib/providers/types';

const RevalidateBodySchema = z.object({
  canonicalIds: z.array(z.string()).optional(),
});

function isAuthorized(authHeader: string | null, secret: string): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const tokenBuf = Buffer.from(token, 'utf8');
  const secretBuf = Buffer.from(secret, 'utf8');

  if (tokenBuf.length !== secretBuf.length) {
    return false;
  }
  return timingSafeEqual(tokenBuf, secretBuf);
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: 'REVALIDATE_SECRET is not configured' },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (!isAuthorized(authHeader, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsedBody = RevalidateBodySchema.safeParse(rawBody);

  const staticPaths = [
    '/',
    '/stack',
    '/pulse',
    '/changelog',
    '/status',
    '/compare',
    '/sitemap.xml',
    '/feed.xml',
    '/llms.txt',
    '/api/v1/models',
    '/api/v1/route',
  ];

  revalidateTag('leaderboard');
  for (const path of staticPaths) {
    revalidatePath(path);
  }
  for (const task of TASK_DEFINITIONS) {
    revalidatePath(`/best/${task.slug}`);
  }
  for (const slug of Object.keys(getProvidersConfig())) {
    revalidatePath(`/providers/${slug}`);
  }
  if (parsedBody.success && parsedBody.data.canonicalIds) {
    for (const id of parsedBody.data.canonicalIds) {
      revalidatePath(`/models/${encodeURIComponent(id)}`);
    }
  }

  return NextResponse.json({ revalidated: true, timestamp: new Date().toISOString() });
}
