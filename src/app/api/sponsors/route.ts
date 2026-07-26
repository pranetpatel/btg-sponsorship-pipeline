import { NextRequest } from "next/server";
import { ok, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listSponsorsWithStats, normalizeSponsorInput } from "@/lib/sponsors";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireTeam();
    const sponsors = await listSponsorsWithStats();
    return ok({ sponsors });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireTeam();
    const body = await req.json();
    const row = normalizeSponsorInput(body);

    const { data, error } = await supabaseAdmin()
      .from("sponsors")
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(error.message);

    await logActivity({
      actor: member.name,
      action: "sponsor.created",
      sponsorId: data.id,
      detail: { name: data.name },
    });

    return ok({ sponsor: data }, 201);
  } catch (err) {
    return handleError(err);
  }
}
