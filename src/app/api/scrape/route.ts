import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";
import type {
  ContactRule,
  LeadCategory,
  LeadSourceOption,
} from "@/lib/scrape-groups";

export const dynamic = "force-dynamic";

/**
 * Takes leads off lead_pool and puts them on the board.
 *
 * There is no discovery here any more. Finding businesses, screening chains,
 * and crawling websites for email addresses all happen in the offline
 * refresh job (npm run leads:refresh), so this route is a filtered read of
 * a table the team already owns — it answers in milliseconds instead of
 * spending five minutes on live API calls that might get rate limited.
 */

type PoolRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  category: string;
  industry: string | null;
  scope: string;
  brand: string | null;
  locations: number;
  source: string;
  notes: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const member = await requireTeam();
    const {
      categories = ["small_business"],
      sources,
      limit = 60,
      localOnly = true,
      contactRule = "email_or_phone",
    } = (await req.json()) as {
      categories?: LeadCategory[];
      sources?: LeadSourceOption[];
      limit?: number;
      localOnly?: boolean;
      contactRule?: ContactRule;
    };

    if (!categories.length) return fail("Pick at least one kind of business");
    const cap = Math.min(Math.max(Number(limit) || 60, 1), 200);

    const db = supabaseAdmin();

    let query = db
      .from("lead_pool")
      .select(
        "id, name, email, phone, website, location, category, industry, scope, brand, locations, source, notes",
      )
      .is("imported_at", null)
      .in("category", categories);

    if (sources?.length) query = query.in("source", sources);
    if (localOnly) query = query.eq("scope", "local");
    if (contactRule === "email") query = query.not("email", "is", null);
    if (contactRule === "email_or_phone") {
      query = query.or("email.not.is.null,phone.not.is.null");
    }

    // Leads with an email first, then the ones with only a phone: if the cap
    // cuts the list short, the team should get the ones they can act on.
    const { data, error } = await query
      .order("email", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true })
      .limit(cap);

    if (error) throw new Error(error.message);

    const leads = (data ?? []) as PoolRow[];
    if (!leads.length) {
      return ok({
        imported: 0,
        skipped: 0,
        withEmail: 0,
        remaining: await countAvailable(db, categories, sources, localOnly),
        empty: true,
      });
    }

    // A lead can already be on the board from a CSV or a previous run under
    // a different source, so match on both email and name before inserting.
    const emails = leads.map((l) => l.email).filter(Boolean) as string[];
    const names = leads.map((l) => l.name);

    const [{ data: byEmail }, { data: byName }] = await Promise.all([
      emails.length
        ? db.from("sponsors").select("email").in("email", emails)
        : Promise.resolve({ data: [] as { email: string | null }[] }),
      db.from("sponsors").select("name").in("name", names),
    ]);

    const takenEmails = new Set(
      (byEmail ?? []).map((r) => r.email?.toLowerCase()).filter(Boolean),
    );
    const takenNames = new Set(
      (byName ?? []).map((r) => r.name.toLowerCase()),
    );

    const fresh = leads.filter(
      (l) =>
        !(l.email && takenEmails.has(l.email.toLowerCase())) &&
        !takenNames.has(l.name.toLowerCase()),
    );
    const skipped = leads.length - fresh.length;

    let imported = 0;
    if (fresh.length) {
      const { data: inserted, error: insertError } = await db
        .from("sponsors")
        .insert(
          fresh.map((l) => ({
            name: l.name,
            email: l.email,
            phone: l.phone,
            website: l.website,
            location: l.location ?? "London, ON",
            category: l.category,
            industry: l.industry,
            notes: l.notes,
            source: l.source,
            status: "new",
            custom_fields:
              l.scope === "chain"
                ? {
                    scope: "chain",
                    brand: l.brand ?? "Chain",
                    locations: String(l.locations),
                  }
                : { scope: "local", locations: "1" },
          })),
        )
        .select("id");

      if (insertError) throw new Error(insertError.message);
      imported = inserted?.length ?? 0;
    }

    // Mark every lead we looked at, including duplicates: they are on the
    // board one way or another, and re-offering them helps nobody.
    await db
      .from("lead_pool")
      .update({ imported_at: new Date().toISOString() })
      .in(
        "id",
        leads.map((l) => l.id),
      );

    await logActivity({
      actor: member.name,
      action: "leads.imported",
      detail: { categories, sources, localOnly, contactRule, imported, skipped },
    });

    return ok({
      imported,
      skipped,
      withEmail: fresh.filter((l) => l.email).length,
      remaining: await countAvailable(db, categories, sources, localOnly),
    });
  } catch (err) {
    return handleError(err);
  }
}

/** How many leads are left in the pool under the same filters. */
async function countAvailable(
  db: ReturnType<typeof supabaseAdmin>,
  categories: LeadCategory[],
  sources: LeadSourceOption[] | undefined,
  localOnly: boolean,
) {
  let query = db
    .from("lead_pool")
    .select("id", { count: "exact", head: true })
    .is("imported_at", null)
    .in("category", categories);

  if (sources?.length) query = query.in("source", sources);
  if (localOnly) query = query.eq("scope", "local");

  const { count } = await query;
  return count ?? 0;
}
