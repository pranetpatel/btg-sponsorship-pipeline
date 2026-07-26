import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const RESPONSES = new Set([
  "pending",
  "no_response",
  "replied",
  "bounced",
  "failed",
  "unsubscribed",
]);

/** Lets the team mark an outreach as replied / bounced from the drawer. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await requireTeam();
    const { id } = await params;
    const { response_status } = (await req.json()) as {
      response_status?: string;
    };

    if (!response_status || !RESPONSES.has(response_status)) {
      return fail("Invalid response status");
    }

    const { data, error } = await supabaseAdmin()
      .from("outreach_logs")
      .update({ response_status })
      .eq("id", id)
      .select("sponsor_id")
      .single();

    if (error) throw new Error(error.message);

    await logActivity({
      actor: member.name,
      action: "outreach.response_marked",
      sponsorId: data.sponsor_id,
      detail: { response_status },
    });

    return ok({ updated: true });
  } catch (err) {
    return handleError(err);
  }
}
