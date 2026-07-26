import { NextRequest } from "next/server";
import Papa from "papaparse";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";
import { normalizeSponsorInput } from "@/lib/sponsors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Header spellings we accept, mapped to our column names. */
const HEADER_MAP: Record<string, string> = {
  "company": "name",
  "company name": "name",
  "business": "name",
  "business name": "name",
  "organization": "name",
  "organisation": "name",
  "sponsor": "name",
  "name": "name",
  "email": "email",
  "email address": "email",
  "e-mail": "email",
  "contact email": "email",
  "phone": "phone",
  "phone number": "phone",
  "telephone": "phone",
  "tel": "phone",
  "website": "website",
  "url": "website",
  "site": "website",
  "web": "website",
  "category": "category",
  "type": "category",
  "industry": "industry",
  "sector": "industry",
  "location": "location",
  "city": "location",
  "address": "location",
  "status": "status",
  "stage": "status",
  "potential value": "potential_value",
  "potential_value": "potential_value",
  "value": "potential_value",
  "ask": "potential_value",
  "amount": "potential_value",
  "contact": "contact_name",
  "contact name": "contact_name",
  "contact_name": "contact_name",
  "person": "contact_name",
  "notes": "notes",
  "note": "notes",
  "comments": "notes",
};

const KNOWN = new Set(Object.values(HEADER_MAP));

export async function POST(req: NextRequest) {
  try {
    const member = await requireTeam();

    const form = await req.formData();
    const file = form.get("file");
    const rawText = form.get("text");

    let csvText: string;
    if (file instanceof File) csvText = await file.text();
    else if (typeof rawText === "string" && rawText.trim()) csvText = rawText;
    else return fail("Attach a CSV file or paste CSV text");

    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase(),
    });

    if (!parsed.data.length) return fail("That CSV had no data rows");

    const rows = parsed.data.map((raw) => {
      const mapped: Record<string, unknown> = {};
      const custom: Record<string, string> = {};

      for (const [header, value] of Object.entries(raw)) {
        const target = HEADER_MAP[header];
        if (target && KNOWN.has(target)) {
          // First non-empty value wins when two headers map to one column.
          if (!mapped[target] && value) mapped[target] = value;
        } else if (header && value) {
          // Unrecognized columns are preserved rather than dropped.
          custom[header.replace(/\s+/g, "_")] = value;
        }
      }

      return normalizeSponsorInput({
        ...mapped,
        custom_fields: custom,
        source: "csv",
      });
    });

    const valid = rows.filter((r) => r.name && r.name !== "Unnamed");
    if (!valid.length) {
      return fail(
        "No usable rows. The CSV needs a name column (name, company, or business).",
      );
    }

    const db = supabaseAdmin();
    const withEmail = valid.filter((r) => r.email);
    const withoutEmail = valid.filter((r) => !r.email);

    let imported = 0;
    let updated = 0;

    if (withEmail.length) {
      // Dedupe within the file itself before hitting the unique index.
      const byEmail = new Map(withEmail.map((r) => [r.email!, r]));
      const { data, error } = await db
        .from("sponsors")
        .upsert([...byEmail.values()], { onConflict: "email" })
        .select("id, created_at, updated_at");
      if (error) throw new Error(error.message);

      for (const row of data ?? []) {
        if (row.created_at === row.updated_at) imported += 1;
        else updated += 1;
      }
    }

    if (withoutEmail.length) {
      const { data, error } = await db
        .from("sponsors")
        .insert(withoutEmail)
        .select("id");
      if (error) throw new Error(error.message);
      imported += data?.length ?? 0;
    }

    await logActivity({
      actor: member.name,
      action: "sponsors.imported",
      detail: {
        rows: parsed.data.length,
        imported,
        updated,
        skipped: parsed.data.length - valid.length,
      },
    });

    return ok({
      rows: parsed.data.length,
      imported,
      updated,
      skipped: parsed.data.length - valid.length,
      errors: parsed.errors.slice(0, 5).map((e) => e.message),
    });
  } catch (err) {
    return handleError(err);
  }
}
