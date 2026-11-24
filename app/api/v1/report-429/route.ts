import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getProvidersConfig } from '@/lib/providers/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseAnonClient } from '@/lib/supabase/client';

const Report429Schema = z.object({
  provider_slug: z.string().min(1).max(40),
  provider_model_id: z.string().min(1).max(200),
});

const REPORT_COOLDOWN_MS = 60_000;
const recentReportsByKey = new Map<string, number>();

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Records crowdsourced HTTP 429 rate-limit hits with a 60s per-IP/model cooldown.
 */
export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => null);
  const parsed = Report429Schema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid provider_slug or provider_model_id' }, { status: 400 });
  }

  const providersConfig = getProvidersConfig();
  if (!(parsed.data.provider_slug in providersConfig)) {
    return NextResponse.json({ error: 'Unknown provider_slug' }, { status: 400 });
  }

  const now = Date.now();
  const dedupKey = `${getClientIp(request)}:${parsed.data.provider_slug}:${parsed.data.provider_model_id}`;
  const lastSeen = recentReportsByKey.get(dedupKey);
  if (lastSeen && now - lastSeen < REPORT_COOLDOWN_MS) {
    return NextResponse.json({ ok: true, deduplicated: true });
  }
  recentReportsByKey.set(dedupKey, now);

  if (recentReportsByKey.size > 1_000) {
    for (const [key, ts] of recentReportsByKey.entries()) {
      if (now - ts >= REPORT_COOLDOWN_MS) {
        recentReportsByKey.delete(key);
      }
    }
  }

  try {
    let client = null;
    if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() && process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
      client = getSupabaseAdminClient();
    } else {
      client = getSupabaseAnonClient();
    }

    if (client) {
      await client.from('rate_limit_reports').insert({
        provider_slug: parsed.data.provider_slug,
        provider_model_id: parsed.data.provider_model_id,
      });
    }
  } catch {
    // Gracefully degrade when database is not configured in local/seed mode.
  }

  return NextResponse.json({ ok: true });
}
