import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const EDITABLE = new Set([
  "name",
  "email",
  "phone",
  "website",
  "category",
  "industry",
  "location",
  "status",
  "potential_value",
  "contact_name",
  "notes",
  "custom_fields",
]);

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireTeam();
    const { id } = await params;
    const db = supabaseAdmin();

    const [sponsorRes, logsRes] = await Promise.all([
      db.from("sponsors").select("*").eq("id", id).single(),
      db
        .from("outreach_logs")
        .select("*")
        .eq("sponsor_id", id)
        .order("sent_at", { ascending: false }),
    ]);

    if (sponsorRes.error) return fail("Sponsor not found", 404);
    return ok({ sponsor: sponsorRes.data, logs: logsRes.data ?? [] });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const member = await requireTeam();
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (EDITABLE.has(k)) patch[k] = v;
    }
    if (patch.email && typeof patch.email === "string") {
      patch.email = patch.email.trim().toLowerCase() || null;
    }
    if (!Object.keys(patch).length) return fail("Nothing to update");

    const { data, error } = await supabaseAdmin()
      .from("sponsors")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    await logActivity({
      actor: member.name,
      action: patch.status ? "sponsor.status_changed" : "sponsor.updated",
      sponsorId: id,
      detail: { name: data.name, changes: patch },
    });

    return ok({ sponsor: data });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const member = await requireTeam();
    const { id } = await params;

    const { data } = await supabaseAdmin()
      .from("sponsors")
      .select("name")
      .eq("id", id)
      .single();

    const { error } = await supabaseAdmin()
      .from("sponsors")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);

    await logActivity({
      actor: member.name,
      action: "sponsor.deleted",
      detail: { name: data?.name ?? id },
    });

    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
