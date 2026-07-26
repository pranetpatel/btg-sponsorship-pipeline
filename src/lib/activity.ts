import { supabaseAdmin } from "./supabase/admin";

/**
 * Append-only team activity feed. Never throws: a failed log line must not
 * take down the action it was describing.
 */
export async function logActivity(entry: {
  actor: string;
  action: string;
  sponsorId?: string | null;
  detail?: Record<string, unknown>;
}) {
  try {
    await supabaseAdmin().from("activity_log").insert({
      actor: entry.actor,
      action: entry.action,
      sponsor_id: entry.sponsorId ?? null,
      detail: entry.detail ?? {},
    });
  } catch (err) {
    console.error("activity log failed", err);
  }
}
