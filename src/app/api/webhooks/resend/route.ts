import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Resend delivery webhook.
 *
 * Optional but worth wiring up: Resend's own open/click signals catch cases
 * our pixel misses, and bounce/complaint events are the only reliable way to
 * learn an address is dead. Point Resend at /api/webhooks/resend and set
 * RESEND_WEBHOOK_SECRET to the signing secret it gives you.
 */

type ResendEvent = {
  type: string;
  data?: { email_id?: string; headers?: { name: string; value: string }[] };
};

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    // Svix headers, which is what Resend signs with.
    const sig = req.headers.get("svix-signature");
    if (!sig) return fail("Missing signature", 401);
  }

  if (!supabaseConfigured()) return ok({ ignored: true });

  let event: ResendEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return fail("Bad payload");
  }

  const providerId = event.data?.email_id;
  if (!providerId) return ok({ ignored: true });

  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = {};
  switch (event.type) {
    case "email.opened":
      patch.opened = true;
      patch.opened_at = now;
      break;
    case "email.clicked":
      patch.clicked = true;
      patch.clicked_at = now;
      patch.opened = true;
      break;
    case "email.bounced":
      patch.response_status = "bounced";
      break;
    case "email.complained":
      patch.response_status = "unsubscribed";
      break;
    case "email.delivery_delayed":
    case "email.failed":
      patch.response_status = "failed";
      break;
    default:
      return ok({ ignored: event.type });
  }

  await db.from("outreach_logs").update(patch).eq("provider_id", providerId);
  return ok({ applied: event.type });
}
