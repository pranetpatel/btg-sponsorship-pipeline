import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { ORG } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ logId: string }> },
) {
  const { logId } = await params;
  const target = req.nextUrl.searchParams.get("url");

  // Only ever redirect to an http(s) URL we can parse, so this route can
  // never be turned into an open redirect to something like javascript:.
  let destination = ORG.instagram;
  if (target) {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        destination = parsed.toString();
      }
    } catch {
      // keep the fallback
    }
  }

  if (supabaseConfigured()) {
    try {
      const db = supabaseAdmin();
      const { data } = await db
        .from("outreach_logs")
        .select("click_count, clicked_at, opened, opened_at")
        .eq("id", logId)
        .single();

      if (data) {
        const now = new Date().toISOString();
        await db
          .from("outreach_logs")
          .update({
            clicked: true,
            clicked_at: data.clicked_at ?? now,
            click_count: (data.click_count ?? 0) + 1,
            // A click proves an open even when the pixel was blocked.
            opened: true,
            opened_at: data.opened_at ?? now,
          })
          .eq("id", logId);
      }
    } catch (err) {
      console.error("click tracking failed", err);
    }
  }

  return NextResponse.redirect(destination, 302);
}
