import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function pixelResponse() {
  return new NextResponse(new Uint8Array(PIXEL), {
    headers: {
      "content-type": "image/gif",
      "content-length": String(PIXEL.length),
      // Without this, Gmail's proxy caches the pixel and we only ever see
      // the first open.
      "cache-control": "no-store, no-cache, must-revalidate, private",
      pragma: "no-cache",
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ logId: string }> },
) {
  const { logId } = await params;

  // The pixel always returns an image. Tracking is best effort and must
  // never surface an error inside someone's inbox.
  if (supabaseConfigured()) {
    try {
      const db = supabaseAdmin();
      const { data } = await db
        .from("outreach_logs")
        .select("open_count, opened_at")
        .eq("id", logId)
        .single();

      if (data) {
        await db
          .from("outreach_logs")
          .update({
            opened: true,
            opened_at: data.opened_at ?? new Date().toISOString(),
            open_count: (data.open_count ?? 0) + 1,
          })
          .eq("id", logId);
      }
    } catch (err) {
      console.error("open tracking failed", err);
    }
  }

  return pixelResponse();
}
