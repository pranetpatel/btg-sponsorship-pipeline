import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";
import { STATUSES } from "@/lib/constants";
import type { SponsorStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Bulk status change or bulk delete for the table/kanban multi-select. */
export async function POST(req: NextRequest) {
  try {
    const member = await requireTeam();
    const { ids, action, status } = (await req.json()) as {
      ids?: string[];
      action?: "status" | "delete";
      status?: SponsorStatus;
    };

    if (!Array.isArray(ids) || !ids.length) return fail("No sponsors selected");

    const db = supabaseAdmin();

    if (action === "delete") {
      const { error } = await db.from("sponsors").delete().in("id", ids);
      if (error) throw new Error(error.message);
      await logActivity({
        actor: member.name,
        action: "sponsor.bulk_deleted",
        detail: { count: ids.length },
      });
      return ok({ deleted: ids.length });
    }

    if (!status || !STATUSES.includes(status)) return fail("Invalid status");

    const { data, error } = await db
      .from("sponsors")
      .update({ status })
      .in("id", ids)
      .select("id");

    if (error) throw new Error(error.message);

    await logActivity({
      actor: member.name,
      action: "sponsor.bulk_status",
      detail: { count: data?.length ?? 0, status },
    });

    return ok({ updated: data?.length ?? 0, status });
  } catch (err) {
    return handleError(err);
  }
}
