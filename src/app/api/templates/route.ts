import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireTeam();
    const { data, error } = await supabaseAdmin()
      .from("email_templates")
      .select("*")
      .order("is_default", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return ok({ templates: data ?? [] });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireTeam();
    const { name, category, subject, body, description } = await req.json();

    if (!name || !subject || !body) {
      return fail("Name, subject, and body are required");
    }

    const slug = `${String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;

    const { data, error } = await supabaseAdmin()
      .from("email_templates")
      .insert({
        slug,
        name,
        category: category ?? "other",
        subject,
        body,
        description: description ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    await logActivity({
      actor: member.name,
      action: "template.created",
      detail: { name },
    });

    return ok({ template: data }, 201);
  } catch (err) {
    return handleError(err);
  }
}
