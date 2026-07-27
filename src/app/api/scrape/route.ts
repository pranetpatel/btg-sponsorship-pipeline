import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";
import {
  fetchOsmLeads,
  enrichEmails,
  type ScrapedLead,
  type ScrapeGroup,
} from "@/lib/scraper";
import type { ContactRule } from "@/lib/scrape-groups";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Whatever is left of maxDuration once Overpass has had its turn, minus a
 * reserve for the inserts at the end. Overpass can spend minutes backing off
 * a rate limit, so the website crawl has to take what remains rather than
 * assume a fixed slice — otherwise a slow lead search kills the whole
 * request and the team gets nothing.
 */
const REQUEST_BUDGET_MS = 285_000;
const INSERT_RESERVE_MS = 25_000;

/** Does this lead clear the bar the team set for contact info? */
function reachable(lead: ScrapedLead, rule: ContactRule) {
  if (rule === "any") return true;
  if (rule === "email") return Boolean(lead.email);
  return Boolean(lead.email || lead.phone);
}

export async function POST(req: NextRequest) {
  try {
    const startedAt = Date.now();
    const member = await requireTeam();
    const {
      groups = ["local_business"],
      limit = 60,
      findEmails = true,
      localOnly = true,
      contactRule = "email_or_phone",
    } = (await req.json()) as {
      groups?: ScrapeGroup[];
      limit?: number;
      findEmails?: boolean;
      localOnly?: boolean;
      contactRule?: ContactRule;
    };

    if (!groups.length) return fail("Pick at least one lead type");
    const cap = Math.min(Math.max(Number(limit) || 60, 1), 200);

    // Pull a much wider net than the team asked for, because most of it gets
    // thrown away. Measured over 388 London businesses in OpenStreetMap:
    // about a third are chain locations, and 77% carry no contact details of
    // any kind. Roughly five candidates go in for every usable lead that
    // comes out. The list is trimmed back to `cap` below.
    const pool = Math.min(Math.max(cap * 5, 100), 400);
    const { leads: candidates, scanned, chainsSkipped } = await fetchOsmLeads(
      groups,
      pool,
      { localOnly },
    );

    if (!candidates.length) {
      return ok({
        scanned,
        chainsSkipped,
        found: 0,
        imported: 0,
        skipped: 0,
        emailsFound: 0,
        noContactSkipped: 0,
        withEmail: 0,
      });
    }

    const crawlBudget =
      REQUEST_BUDGET_MS - (Date.now() - startedAt) - INSERT_RESERVE_MS;
    const emailsFound = findEmails
      ? (await enrichEmails(candidates, { deadlineMs: crawlBudget })).found
      : 0;

    const reachableLeads = candidates.filter((l) => reachable(l, contactRule));
    const noContactSkipped = candidates.length - reachableLeads.length;
    const leads = reachableLeads.slice(0, cap);

    const db = supabaseAdmin();

    // Rows without an email cannot use the unique-email upsert, so they are
    // inserted separately after checking for a same-name duplicate.
    const withEmail = leads.filter((l) => l.email);
    const withoutEmail = leads.filter((l) => !l.email);

    let imported = 0;
    let skipped = 0;

    if (withEmail.length) {
      const { data, error } = await db
        .from("sponsors")
        .upsert(
          withEmail.map((l) => ({ ...l, status: "new" })),
          { onConflict: "email", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error(error.message);
      imported += data?.length ?? 0;
      skipped += withEmail.length - (data?.length ?? 0);
    }

    if (withoutEmail.length) {
      const names = withoutEmail.map((l) => l.name);
      const { data: existing } = await db
        .from("sponsors")
        .select("name")
        .in("name", names);
      const taken = new Set((existing ?? []).map((r) => r.name.toLowerCase()));

      const fresh = withoutEmail.filter((l) => !taken.has(l.name.toLowerCase()));
      skipped += withoutEmail.length - fresh.length;

      if (fresh.length) {
        const { data, error } = await db
          .from("sponsors")
          .insert(fresh.map((l) => ({ ...l, status: "new" })))
          .select("id");
        if (error) throw new Error(error.message);
        imported += data?.length ?? 0;
      }
    }

    await logActivity({
      actor: member.name,
      action: "leads.scraped",
      detail: {
        groups,
        localOnly,
        contactRule,
        scanned,
        chainsSkipped,
        noContactSkipped,
        found: leads.length,
        imported,
        skipped,
        emailsFound,
      },
    });

    return ok({
      scanned,
      chainsSkipped,
      noContactSkipped,
      found: leads.length,
      imported,
      skipped,
      emailsFound,
      withEmail: withEmail.length,
    });
  } catch (err) {
    return handleError(err);
  }
}
