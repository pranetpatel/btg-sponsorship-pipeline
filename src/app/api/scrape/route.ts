import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";
import { fetchOsmLeads, enrichEmails, type ScrapeGroup } from "@/lib/scraper";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const member = await requireTeam();
    const {
      groups = ["local_business"],
      limit = 60,
      findEmails = true,
    } = (await req.json()) as {
      groups?: ScrapeGroup[];
      limit?: number;
      findEmails?: boolean;
    };

    if (!groups.length) return fail("Pick at least one lead type");
    const cap = Math.min(Math.max(Number(limit) || 60, 1), 200);

    const leads = await fetchOsmLeads(groups, cap);
    if (!leads.length) {
      return ok({ found: 0, imported: 0, skipped: 0, emailsFound: 0, leads: [] });
    }

    // Cap the website crawl so a big pull cannot run past the function limit.
    const emailsFound = findEmails
      ? (await enrichEmails(leads, Math.min(cap, 40))).found
      : 0;

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
      detail: { groups, found: leads.length, imported, skipped, emailsFound },
    });

    return ok({
      found: leads.length,
      imported,
      skipped,
      emailsFound,
      withEmail: leads.filter((l) => l.email).length,
    });
  } catch (err) {
    return handleError(err);
  }
}
