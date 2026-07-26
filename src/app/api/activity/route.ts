import { handleError, ok } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireTeam();
    const { data, error } = await supabaseAdmin()
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(error.message);
    return ok({ activity: data ?? [] });
  } catch (err) {
    return handleError(err);
  }
}
