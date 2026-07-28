/**
 * Lead discovery, run offline.
 *
 *   npm run leads:refresh                  every source, then crawl for emails
 *   npm run leads:refresh -- --source=overture
 *   npm run leads:refresh -- --no-crawl    skip the website email crawl
 *   npm run leads:refresh -- --crawl-only  only crawl, discover nothing new
 *   npm run leads:refresh -- --max-crawl=500
 *   npm run leads:refresh -- --dry-run     report what each source returns,
 *                                          write nothing, touch no database
 *
 * This used to happen inside the "Add sponsors" request, which capped a run
 * at whatever fit in 300 seconds. Pulling it out here means a refresh can
 * take half an hour if it wants to, and the app just reads the results.
 * Expect to run it monthly — Overture publishes about that often, and
 * directories change slowly.
 *
 * Needs the same environment as the app (NEXT_PUBLIC_SUPABASE_URL and the
 * service-role key); it loads .env.local the way Next.js does.
 */
// @next/env is CommonJS, so it has no named ESM exports to destructure.
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { fetchOvertureLeads, latestOvertureRelease, overturePlaceKey } =
  await import("@/lib/leads/overture");
const { fetchDowntownLondonLeads } = await import(
  "@/lib/leads/downtown-london"
);
const { fetchLondonChamberLeads } = await import("@/lib/leads/london-chamber");
const { countByName, toPooledLead } = await import("@/lib/leads/types");
const { upsertLeads, listUncrawled, crawlPooledEmails, poolStats } =
  await import("@/lib/leads/store");

type SourceName = "overture" | "downtown_london" | "london_chamber";

const ALL_SOURCES: SourceName[] = [
  "overture",
  "downtown_london",
  "london_chamber",
];

function parseArgs(argv: string[]) {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const requested = value("source")?.split(",").map((s) => s.trim());
  const unknown = requested?.filter(
    (s) => !ALL_SOURCES.includes(s as SourceName),
  );
  if (unknown?.length) {
    throw new Error(
      `Unknown source "${unknown.join(", ")}". Pick from: ${ALL_SOURCES.join(", ")}`,
    );
  }

  const dryRun = flag("dry-run");

  return {
    sources: (requested as SourceName[] | undefined) ?? ALL_SOURCES,
    // A dry run has nothing to crawl, since crawling reads from the pool.
    crawl: !flag("no-crawl") && !dryRun,
    crawlOnly: flag("crawl-only"),
    maxCrawl: Number(value("max-crawl") ?? 4000),
    release: value("overture-release"),
    dryRun,
  };
}

const log = (message: string) => console.log(message);
const step = (message: string) => console.log(`\n▸ ${message}`);

async function runSource(name: SourceName, release?: string) {
  switch (name) {
    case "overture": {
      const pinned = release ?? (await latestOvertureRelease());
      const leads = await fetchOvertureLeads(pinned, (m) => log(`  .. ${m}`));
      // Two records at one address is one business mapped twice; two at
      // different addresses is a chain.
      return { leads, placeKey: overturePlaceKey };
    }
    case "downtown_london": {
      const leads = await fetchDowntownLondonLeads((m) => log(`  .. ${m}`));
      return { leads, placeKey: (l: (typeof leads)[number]) => l.location ?? l.sourceRef };
    }
    case "london_chamber": {
      const leads = await fetchLondonChamberLeads((m) => log(`  .. ${m}`));
      return { leads, placeKey: (l: (typeof leads)[number]) => l.location ?? l.sourceRef };
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  if (!args.crawlOnly) {
    for (const name of args.sources) {
      step(`${name}`);
      try {
        const { leads, placeKey } = await runSource(name, args.release);
        if (!leads.length) {
          log("  no leads returned");
          continue;
        }

        const counts = countByName(leads, placeKey);
        const pooled = leads.map((lead) => toPooledLead(lead, counts));

        const chains = pooled.filter((l) => l.scope === "chain").length;
        const emails = pooled.filter((l) => l.email).length;
        const phones = pooled.filter((l) => l.phone).length;
        const sites = pooled.filter((l) => l.website).length;
        const share = (n: number) => `${((n / pooled.length) * 100).toFixed(0)}%`;

        if (args.dryRun) {
          log(
            `  ${pooled.length} leads — ${chains} chains (${share(chains)}), ` +
              `${emails} email (${share(emails)}), ${phones} phone (${share(phones)}), ` +
              `${sites} website (${share(sites)})`,
          );

          // The board defaults to independents only, so this slice is what
          // the team actually sees.
          const local = pooled.filter((l) => l.scope === "local");
          const localShare = (n: number) =>
            local.length ? `${((n / local.length) * 100).toFixed(0)}%` : "0%";
          const localEmail = local.filter((l) => l.email).length;
          const localReachable = local.filter((l) => l.email || l.phone).length;
          const localCrawlable = local.filter((l) => !l.email && l.website).length;
          log(
            `  of ${local.length} independents: ${localEmail} email (${localShare(localEmail)}), ` +
              `${localReachable} reachable (${localShare(localReachable)}), ` +
              `${localCrawlable} more to crawl`,
          );
          for (const sample of pooled.slice(0, 3)) {
            log(
              `    e.g. ${sample.name} · ${sample.category} · ${sample.email ?? sample.phone ?? "no contact"}`,
            );
          }
          continue;
        }

        const { written } = await upsertLeads(pooled);
        log(
          `  saved ${written} of ${pooled.length} (${chains} tagged as chains, ` +
            `${emails} arrived with an email)`,
        );
      } catch (err) {
        // One bad source should not cost us the other two.
        log(`  FAILED: ${(err as Error).message}`);
      }
    }
  }

  if (args.crawl) {
    step("crawling websites for emails");
    const targets = await listUncrawled(args.maxCrawl);
    log(`  ${targets.length} pooled leads have a website but no email`);

    if (targets.length) {
      const { found, checked } = await crawlPooledEmails(targets, {}, log);
      log(`  visited ${checked} sites, found ${found} emails`);
    }
  }

  if (args.dryRun) {
    log(`\ndry run — nothing was written`);
    return;
  }

  step("pool");
  const stats = await poolStats();
  log(`  ${stats.total} leads: ${stats.local} local, ${stats.chain} chain`);
  log(`  ${stats.withEmail} with an email, ${stats.withPhone} with a phone`);
  log(`  ${stats.available} not yet on the board`);
  log(`\ndone in ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min`);
}

await main();
