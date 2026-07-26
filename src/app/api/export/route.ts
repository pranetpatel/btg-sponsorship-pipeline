import { NextRequest } from "next/server";
import { handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { listSponsorsWithStats } from "@/lib/sponsors";
import Papa from "papaparse";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "name",
  "contact_name",
  "email",
  "phone",
  "website",
  "category",
  "industry",
  "location",
  "status",
  "potential_value",
  "outreach_count",
  "last_outreach_at",
  "ever_opened",
  "ever_clicked",
  "latest_response",
  "source",
  "notes",
  "created_at",
] as const;

/** CSV export, optionally narrowed by ?status= and ?category= (comma lists). */
export async function GET(req: NextRequest) {
  try {
    await requireTeam();

    const params = req.nextUrl.searchParams;
    const statuses = params.get("status")?.split(",").filter(Boolean);
    const categories = params.get("category")?.split(",").filter(Boolean);

    let rows = await listSponsorsWithStats();
    if (statuses?.length) rows = rows.filter((r) => statuses.includes(r.status));
    if (categories?.length)
      rows = rows.filter((r) => categories.includes(r.category));

    const csv = Papa.unparse(
      rows.map((r) =>
        Object.fromEntries(
          COLUMNS.map((c) => [c, (r as Record<string, unknown>)[c] ?? ""]),
        ),
      ),
      { columns: [...COLUMNS] },
    );

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="btg-sponsors-${stamp}.csv"`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
