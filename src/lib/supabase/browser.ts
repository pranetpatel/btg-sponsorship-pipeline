"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Read-only + realtime client for the dashboard. All writes go through
 * the app's own API routes, which use the service-role key server-side.
 */
let cached: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (!cached) {
    const { url, publishableKey } = getSupabaseEnv();
    cached = createBrowserClient(
      url!,
      publishableKey!,
    );
  }
  return cached;
}

export const realtimeEnabled = () => {
  const { url, publishableKey } = getSupabaseEnv();
  return Boolean(url && publishableKey);
};
