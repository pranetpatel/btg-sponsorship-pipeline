import { NextRequest } from "next/server";
import { ok, fail, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity";
import { isEmail } from "@/lib/sponsors";
import {
  resend,
  resendConfigured,
  render,
  tokensFor,
  buildHtml,
} from "@/lib/email";
import type { Sponsor, EmailTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SendBody = {
  sponsorIds: string[];
  templateId?: string;
  templateSlug?: string;
  /** Overrides the template body/subject for this send only. */
  subject?: string;
  body?: string;
  /** Preview mode returns the rendered emails without sending anything. */
  dryRun?: boolean;
};

type SendResult = {
  sponsorId: string;
  sponsorName: string;
  email: string | null;
  status: "sent" | "skipped" | "failed";
  reason?: string;
  subject?: string;
  body?: string;
};

export async function POST(req: NextRequest) {
  try {
    const member = await requireTeam();
    const payload = (await req.json()) as SendBody;
    const { sponsorIds, dryRun } = payload;

    if (!Array.isArray(sponsorIds) || !sponsorIds.length) {
      return fail("Select at least one sponsor");
    }
    if (!dryRun && !resendConfigured()) {
      return fail(
        "Email is not configured. Set RESEND_API_KEY and RESEND_FROM, then try again.",
        503,
      );
    }

    const db = supabaseAdmin();

    // Load the template unless the composer supplied both fields outright.
    let template: EmailTemplate | null = null;
    if (payload.templateId || payload.templateSlug) {
      const query = db.from("email_templates").select("*");
      const { data, error } = payload.templateId
        ? await query.eq("id", payload.templateId).single()
        : await query.eq("slug", payload.templateSlug!).single();
      if (error) return fail("Template not found", 404);
      template = data as EmailTemplate;
    }

    const subjectSrc = payload.subject ?? template?.subject;
    const bodySrc = payload.body ?? template?.body;
    if (!subjectSrc || !bodySrc) {
      return fail("Pick a template or write a subject and body");
    }

    const { data: sponsorRows, error: sponsorErr } = await db
      .from("sponsors")
      .select("*")
      .in("id", sponsorIds);
    if (sponsorErr) throw new Error(sponsorErr.message);

    const sponsors = (sponsorRows ?? []) as Sponsor[];
    const results: SendResult[] = [];
    const contactedIds: string[] = [];
    const from = process.env.RESEND_FROM ?? "onboarding@resend.dev";
    const replyTo = process.env.RESEND_REPLY_TO || undefined;

    for (const sponsor of sponsors) {
      const tokens = tokensFor({ sponsor, senderName: member.name });
      const subject = render(subjectSrc, tokens);
      const body = render(bodySrc, tokens);

      if (!isEmail(sponsor.email)) {
        results.push({
          sponsorId: sponsor.id,
          sponsorName: sponsor.name,
          email: sponsor.email,
          status: "skipped",
          reason: sponsor.email ? "Email looks invalid" : "No email on file",
          subject,
          body,
        });
        continue;
      }

      if (dryRun) {
        results.push({
          sponsorId: sponsor.id,
          sponsorName: sponsor.name,
          email: sponsor.email,
          status: "sent",
          subject,
          body,
        });
        continue;
      }

      // The log row is created first so its id can be baked into the
      // tracking pixel and click-through links inside the HTML body.
      const { data: log, error: logErr } = await db
        .from("outreach_logs")
        .insert({
          sponsor_id: sponsor.id,
          outreach_type: "email",
          template_used: template?.name ?? "Custom",
          template_id: template?.id ?? null,
          subject,
          body,
          to_email: sponsor.email,
          sent_by: member.name,
          response_status: "pending",
        })
        .select("id")
        .single();

      if (logErr || !log) {
        results.push({
          sponsorId: sponsor.id,
          sponsorName: sponsor.name,
          email: sponsor.email,
          status: "failed",
          reason: logErr?.message ?? "Could not write outreach log",
        });
        continue;
      }

      try {
        const sent = await resend().emails.send({
          from,
          to: sponsor.email!,
          subject,
          text: body,
          html: buildHtml(body, log.id),
          replyTo,
          headers: { "X-Entity-Ref-ID": log.id },
        });

        if (sent.error) throw new Error(sent.error.message);

        await db
          .from("outreach_logs")
          .update({ provider_id: sent.data?.id ?? null })
          .eq("id", log.id);

        contactedIds.push(sponsor.id);
        results.push({
          sponsorId: sponsor.id,
          sponsorName: sponsor.name,
          email: sponsor.email,
          status: "sent",
          subject,
        });
      } catch (err) {
        const message = (err as Error).message ?? "Send failed";
        await db
          .from("outreach_logs")
          .update({ response_status: "failed", error: message })
          .eq("id", log.id);

        results.push({
          sponsorId: sponsor.id,
          sponsorName: sponsor.name,
          email: sponsor.email,
          status: "failed",
          reason: message,
        });
      }
    }

    // Anyone who was still "new" moves to "contacted". Sponsors further
    // along the funnel keep their status so a follow-up cannot walk them back.
    if (contactedIds.length) {
      await db
        .from("sponsors")
        .update({
          status: "contacted",
          last_contacted_at: new Date().toISOString(),
        })
        .in("id", contactedIds)
        .eq("status", "new");

      await db
        .from("sponsors")
        .update({ last_contacted_at: new Date().toISOString() })
        .in("id", contactedIds)
        .neq("status", "new");

      await logActivity({
        actor: member.name,
        action: "outreach.sent",
        detail: {
          count: contactedIds.length,
          template: template?.name ?? "Custom",
        },
      });
    }

    return ok({
      dryRun: Boolean(dryRun),
      sent: results.filter((r) => r.status === "sent").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (err) {
    return handleError(err);
  }
}
