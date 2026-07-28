import { supabaseAdmin } from "@/lib/supabase/admin";
import { findEmailForSite } from "@/lib/leads/emails";
import type { PooledLead } from "./types";

/**
 * Reading and writing lead_pool.
 *
 * The pool is deliberately append-and-update rather than replace-on-refresh.
 * A row can carry an email the crawler dug up months ago and the source
 * itself still does not publish, so wiping and reloading would throw away
 * the most expensive data we hold.
 */

/** Columns a refresh is allowed to overwrite from the source. */
type UpsertRow = PooledLead & { updated_at: string };

export async function upsertLeads(leads: PooledLead[]) {
  if (!leads.length) return { written: 0 };

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  let written = 0;

  // Supabase rejects very large single statements, so write in batches.
  for (let i = 0; i < leads.length; i += 500) {
    const batch: UpsertRow[] = leads
      .slice(i, i + 500)
      .map((lead) => ({ ...lead, updated_at: now }));

    const { data, error } = await db
      .from("lead_pool")
      .upsert(batch, { onConflict: "source,source_ref" })
      .select("id");

    if (error) throw new Error(`lead_pool upsert failed: ${error.message}`);
    written += data?.length ?? 0;
  }

  return { written };
}

/**
 * An upsert would clobber a discovered email with the source's null, so
 * emails found by crawling are written back separately, one row at a time
 * but only for the rows that actually changed.
 */
export async function recordCrawledEmail(
  id: string,
  email: string | null,
  note: string | null,
) {
  const db = supabaseAdmin();
  const { error } = await db
    .from("lead_pool")
    .update({
      email,
      notes: note,
      website_checked_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`lead_pool update failed: ${error.message}`);
}

export type CrawlTarget = {
  id: string;
  name: string;
  website: string;
  notes: string | null;
};

/** Pool rows with a website, no email, and no crawl attempt on record. */
export async function listUncrawled(limit: number): Promise<CrawlTarget[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("lead_pool")
    .select("id, name, website, notes")
    .is("email", null)
    .is("website_checked_at", null)
    .not("website", "is", null)
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as CrawlTarget[];
}

/**
 * Crawls pooled websites for an email address, in parallel and bounded by a
 * wall-clock deadline. Every row visited gets website_checked_at stamped
 * whether or not an address turned up, so the next run moves on instead of
 * retrying the same dead sites forever.
 */
export async function crawlPooledEmails(
  targets: CrawlTarget[],
  opts: { concurrency?: number; deadlineMs?: number } = {},
  onProgress?: (message: string) => void,
) {
  const { concurrency = 8, deadlineMs = 30 * 60_000 } = opts;
  if (!targets.length) return { found: 0, checked: 0 };

  const stopAt = Date.now() + deadlineMs;
  let next = 0;
  let found = 0;
  let checked = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= targets.length || Date.now() > stopAt) return;

      const target = targets[i];
      const hit = await findEmailForSite(target.website, stopAt);

      const note = hit
        ? `${target.notes ?? ""} Email found on ${hit.page}.${
            hit.offDomain
              ? " Heads up: that address is on a different domain than their website, so double check it belongs to them before sending."
              : ""
          }`.trim()
        : target.notes;

      await recordCrawledEmail(target.id, hit?.email ?? null, note);

      checked += 1;
      if (hit) found += 1;
      if (checked % 100 === 0) {
        onProgress?.(`  crawled ${checked}/${targets.length}, ${found} emails`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, worker),
  );

  return { found, checked };
}

export type PoolStats = {
  total: number;
  local: number;
  chain: number;
  withEmail: number;
  withPhone: number;
  available: number;
};

export async function poolStats(): Promise<PoolStats> {
  const db = supabaseAdmin();
  const rows = db.from("lead_pool");

  const [total, local, chain, withEmail, withPhone, available] =
    await Promise.all([
      rows.select("id", { count: "exact", head: true }),
      rows.select("id", { count: "exact", head: true }).eq("scope", "local"),
      rows.select("id", { count: "exact", head: true }).eq("scope", "chain"),
      rows.select("id", { count: "exact", head: true }).not("email", "is", null),
      rows.select("id", { count: "exact", head: true }).not("phone", "is", null),
      rows.select("id", { count: "exact", head: true }).is("imported_at", null),
    ]);

  for (const result of [total, local, chain, withEmail, withPhone, available]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    total: total.count ?? 0,
    local: local.count ?? 0,
    chain: chain.count ?? 0,
    withEmail: withEmail.count ?? 0,
    withPhone: withPhone.count ?? 0,
    available: available.count ?? 0,
  };
}
