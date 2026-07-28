import { NextRequest } from "next/server";
import { ok, handleError } from "@/lib/api";
import { requireTeam } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { refreshPool } from "@/lib/leads/refresh";
import { poolStats } from "@/lib/leads/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refills the lead pool from the sources that can run on a function.
 *
 * Two callers, and they authenticate differently:
 *
 *   Vercel Cron sends Authorization: Bearer $CRON_SECRET on a schedule.
 *   A team member hits the button in Add sponsors, carrying the team cookie.
 *
 * Anything else is turned away. Without CRON_SECRET set the cron path is
 * simply closed rather than open — an unauthenticated endpoint that makes a
 * thousand outbound requests is not something to leave lying around.
 *
 * Overture is not part of this. It moves gigabytes of Parquet and takes
 * about ten minutes, so it stays a local job: npm run leads:refresh.
 */

/** Leave headroom under maxDuration so the summary always gets returned. */
const BUDGET_MS = 260_000;

function isCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  const cron = isCron(req);
  let actor = "cron";

  if (!cron) {
    const member = await requireTeam();
    actor = member.name;
  }

  const crawlOnly =
    new URL(req.url).searchParams.get("crawlOnly") === "true";

  const result = await refreshPool({ deadlineMs: BUDGET_MS, crawlOnly });
  const stats = await poolStats();

  await logActivity({
    actor,
    action: "leads.pool_refreshed",
    detail: { ...result, stats },
  });

  return ok({ ...result, stats });
}

/** Vercel Cron issues GET requests. */
export async function GET(req: NextRequest) {
  try {
    return await run(req);
  } catch (err) {
    return handleError(err);
  }
}

/** The in-app button posts. */
export async function POST(req: NextRequest) {
  try {
    return await run(req);
  } catch (err) {
    return handleError(err);
  }
}
