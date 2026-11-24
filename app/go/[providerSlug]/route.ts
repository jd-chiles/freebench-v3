import { NextResponse } from 'next/server';
import { getProvidersConfig } from '@/lib/providers/types';
import type { ProviderSlug } from '@/lib/supabase/types';

export async function GET(
  _request: Request,
  context: { params: Promise<{ providerSlug: string }> }
) {
  const { providerSlug } = await context.params;
  const configMap = getProvidersConfig();

  if (!(providerSlug in configMap)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  }

  const provider = configMap[providerSlug as ProviderSlug];
  const destination = provider.affiliate_url ?? provider.signup_url;

  return NextResponse.redirect(destination, {
    status: 302,
    headers: {
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  });
}
