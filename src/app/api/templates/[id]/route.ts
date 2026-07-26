import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const member = await requireTeam();
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    for (const k of ["name", "category", "subject", "body", "description"]) {
      if (k in body) patch[k] = body[k];
    }
    if (!Object.keys(patch).length) return fail("Nothing to update");

    const { data, error } = await supabaseAdmin()
      .from("email_templates")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    await logActivity({
      actor: member.name,
      action: "template.updated",
      detail: { name: data.name },
    });

    return ok({ template: data });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const member = await requireTeam();
    const { id } = await params;

    const { data: existing } = await supabaseAdmin()
      .from("email_templates")
      .select("name, is_default")
      .eq("id", id)
      .single();

    if (existing?.is_default) {
      return fail(
        "The five built in templates cannot be deleted. Edit them instead.",
      );
    }

    const { error } = await supabaseAdmin()
      .from("email_templates")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);

    await logActivity({
      actor: member.name,
      action: "template.deleted",
      detail: { name: existing?.name ?? id },
    });

    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
