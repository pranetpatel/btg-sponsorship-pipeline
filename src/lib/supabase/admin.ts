import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Server-only client using the service-role key. Bypasses RLS, so it must
 * never be imported into a client component. Every route that uses it sits
 * behind requireTeam() in src/lib/session.ts.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  const { url, serviceRoleKey } = getSupabaseEnv();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL plus either SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }

  if (!cached) {
    cached = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

export function supabaseConfigured() {
  const { url, serviceRoleKey } = getSupabaseEnv();
  return Boolean(url && serviceRoleKey);
}
