import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAnonClient } from '@/lib/supabase/client';

const NewsletterBodySchema = z.object({
  email: z.string().trim().email('Please enter a valid email address'),
  sourcePath: z.string().max(200).optional(),
});

const NEWSLETTER_COOLDOWN_MS = 30_000;
const recentSubscribesByIp = new Map<string, number>();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function sanitizeSourcePath(raw: string | undefined): string {
  if (!raw) return '/';
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned.startsWith('/') || cleaned.startsWith('//')) {
    return '/';
  }
  return cleaned;
}

export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => null);
  const parsed = NewsletterBodySchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid email address' },
      { status: 400 }
    );
  }

  const now = Date.now();
  const ip = getClientIp(request);
  const lastAttempt = recentSubscribesByIp.get(ip);
  if (lastAttempt && now - lastAttempt < NEWSLETTER_COOLDOWN_MS) {
    return NextResponse.json(
      { error: 'Please wait before subscribing again.' },
      { status: 429 }
    );
  }
  recentSubscribesByIp.set(ip, now);

  if (recentSubscribesByIp.size > 1_000) {
    for (const [key, ts] of recentSubscribesByIp.entries()) {
      if (now - ts >= NEWSLETTER_COOLDOWN_MS) {
        recentSubscribesByIp.delete(key);
      }
    }
  }

  const supabase = getSupabaseAnonClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, mode: 'demo' });
  }

  const { error } = await supabase.from('newsletter_subscribers').upsert(
    {
      email: parsed.data.email.toLowerCase(),
      source_path: sanitizeSourcePath(parsed.data.sourcePath),
    },
    { onConflict: 'email' }
  );

  if (error) {
    return NextResponse.json(
      { error: 'Unable to save subscription right now.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, mode: 'live' });
}
