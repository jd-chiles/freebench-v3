import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a read-only anonymous Supabase client for Next.js Server Components
 * and public route handlers. Returns null when Supabase env vars are unset so
 * local development and preview builds fall back gracefully to the seed snapshot.
 */
export function getSupabaseAnonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    return null;
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
