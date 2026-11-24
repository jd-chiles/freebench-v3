import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAnonClient } from '@/lib/supabase/client';

const NewsletterBodySchema = z.object({
  email: z.string().trim().email('Please enter a valid email address'),
  sourcePath: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => null);
  const parsed = NewsletterBodySchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid email address' },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAnonClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, mode: 'demo' });
  }

  const { error } = await supabase.from('newsletter_subscribers').upsert(
    {
      email: parsed.data.email.toLowerCase(),
      source_path: parsed.data.sourcePath ?? '/',
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
