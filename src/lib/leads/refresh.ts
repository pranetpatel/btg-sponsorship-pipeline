import { fetchDowntownLondonLeads } from "./downtown-london";
import { fetchChamberRoster, fetchChamberWebsites } from "./london-chamber";
import { countByName, toPooledLead, type DiscoveredLead } from "./types";
import {
  crawlPooledEmails,
  listUncrawled,
  listUndetailed,
  recordDetails,
  upsertLeads,
} from "./store";

/**
 * The part of lead discovery that can run on a serverless function.
 *
 * Everything here is plain HTTP against directories, so it fits in a Vercel
 * function — unlike the Overture pull, which moves gigabytes of Parquet and
 * stays a local job (see scripts/refresh-leads.mts).
 *
 * The whole pass is bounded by a wall-clock deadline and every stage is
 * resumable, because none of this fits in one invocation on the first run:
 * the Chamber alone is 900-odd member pages and the email crawl is a few
 * thousand websites. Each stage records what it finished, so tomorrow's run
 * continues rather than starting over. Give it a few nights to converge and
 * it then just keeps up with what changed.
 *
 * Stages run cheapest-first so a short budget still accomplishes something.
 */

export type RefreshStage = {
  stage: string;
  detail: string;
};

export type RefreshResult = {
  stages: RefreshStage[];
  ranOutOfTime: boolean;
  elapsedMs: number;
};

export type RefreshOptions = {
  /** Total wall-clock budget. Stages stop starting once this is spent. */
  deadlineMs?: number;
  /** Skip the directory pulls and only crawl for emails. */
  crawlOnly?: boolean;
  onProgress?: (message: string) => void;
};

async function poolDirectory(
  leads: DiscoveredLead[],
  placeKey: (lead: DiscoveredLead) => string,
) {
  const counts = countByName(leads, placeKey);
  const pooled = leads.map((lead) => toPooledLead(lead, counts));
  const { written } = await upsertLeads(pooled);
  return { written, total: pooled.length };
}

export async function refreshPool(
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  const { deadlineMs = 240_000, crawlOnly = false, onProgress } = opts;

  const startedAt = Date.now();
  const stopAt = startedAt + deadlineMs;
  const left = () => stopAt - Date.now();
  const stages: RefreshStage[] = [];

  const note = (stage: string, detail: string) => {
    stages.push({ stage, detail });
    onProgress?.(`${stage}: ${detail}`);
  };

  // 1. Downtown London — one request for the whole directory, so it is
  //    always worth doing and always finishes.
  if (!crawlOnly && left() > 30_000) {
    try {
      const leads = await fetchDowntownLondonLeads();
      const { written, total } = await poolDirectory(
        leads,
        (l) => l.location ?? l.sourceRef,
      );
      note("downtown_london", `${written} of ${total} saved`);
    } catch (err) {
      note("downtown_london", `failed: ${(err as Error).message}`);
    }
  }

  // 2. Chamber roster — 49 index pages, no member pages.
  if (!crawlOnly && left() > 60_000) {
    try {
      const leads = await fetchChamberRoster();
      const { written, total } = await poolDirectory(
        leads,
        (l) => l.location ?? l.sourceRef,
      );
      note("london_chamber", `${written} of ${total} members saved`);
    } catch (err) {
      note("london_chamber", `failed: ${(err as Error).message}`);
    }
  }

  // 3. Chamber websites — a slice of the member pages we have not opened.
  if (!crawlOnly && left() > 30_000) {
    try {
      const pending = await listUndetailed("london_chamber", 400);
      if (pending.length) {
        const results = await fetchChamberWebsites(
          pending.map((p) => p.source_ref),
          // Leave a third of the remaining budget for the email crawl.
          { deadlineMs: Math.floor(left() * 0.6) },
          onProgress,
        );
        await recordDetails("london_chamber", results);
        const found = results.filter((r) => r.website).length;
        note(
          "chamber_websites",
          `opened ${results.length} member pages, ${found} had a website` +
            (results.length < pending.length ? ", more left for next run" : ""),
        );
      }
    } catch (err) {
      note("chamber_websites", `failed: ${(err as Error).message}`);
    }
  }

  // 4. Email crawl — the stage that actually produces contacts.
  if (left() > 20_000) {
    try {
      const targets = await listUncrawled(600);
      if (targets.length) {
        const { found, checked } = await crawlPooledEmails(
          targets,
          { deadlineMs: Math.max(left() - 10_000, 0) },
          onProgress,
        );
        note(
          "email_crawl",
          `visited ${checked} sites, found ${found} emails` +
            (checked < targets.length ? ", more left for next run" : ""),
        );
      } else {
        note("email_crawl", "nothing left to crawl");
      }
    } catch (err) {
      note("email_crawl", `failed: ${(err as Error).message}`);
    }
  }

  return {
    stages,
    ranOutOfTime: left() <= 20_000,
    elapsedMs: Date.now() - startedAt,
  };
}
