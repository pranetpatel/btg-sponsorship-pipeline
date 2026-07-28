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

/**
 * Chamber members whose own page has not been opened yet.
 *
 * Ordered oldest-first so a cron run that only gets through part of the
 * roster picks up where the last one stopped instead of restarting.
 */
export async function listUndetailed(
  source: string,
  limit: number,
): Promise<{ id: string; source_ref: string }[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("lead_pool")
    .select("id, source_ref")
    .eq("source", source)
    .is("website", null)
    .is("detail_checked_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; source_ref: string }[];
}

/**
 * Writes back the websites a detail pass found.
 *
 * Every slug handed in gets stamped, including the ones with no website, so
 * they drop out of listUndetailed and the next run moves on.
 */
export async function recordDetails(
  source: string,
  results: { slug: string; website: string | null }[],
) {
  if (!results.length) return;
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const withSite = results.filter((r) => r.website);
  // One statement per distinct website, but a single statement for the much
  // larger group that had none.
  await Promise.all(
    withSite.map((r) =>
      db
        .from("lead_pool")
        .update({ website: r.website, detail_checked_at: now })
        .eq("source", source)
        .eq("source_ref", r.slug),
    ),
  );

  const withoutSite = results.filter((r) => !r.website).map((r) => r.slug);
  if (withoutSite.length) {
    const { error } = await db
      .from("lead_pool")
      .update({ detail_checked_at: now })
      .eq("source", source)
      .in("source_ref", withoutSite);
    if (error) throw new Error(error.message);
  }
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
