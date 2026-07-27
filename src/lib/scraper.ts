import * as cheerio from "cheerio";
import { normalizeCategory } from "./sponsors";
import { classifyLead, normalizeName } from "./chains";
import type { ScrapeGroup } from "./scrape-groups";

export type { ScrapeGroup };

/**
 * Lead discovery for the London, Ontario area.
 *
 * Source is the OpenStreetMap Overpass API: open data, no API key, and no
 * terms-of-service problem the way scraping Google or Yellow Pages would be.
 * OSM gives us name, phone, website, and sometimes a contact email directly.
 *
 * Two things decide whether a lead is worth keeping:
 *
 *   Is it actually local? A branch of TD or Metro cannot say yes to a
 *   sponsorship, so every lead is tagged chain or local (see chains.ts) and
 *   the caller can drop the chains.
 *
 *   Can we reach anyone? OSM rarely carries an email, so for every lead with
 *   a website we crawl the homepage and its contact pages looking for one.
 *   Leads that come out the other side with no email and no phone are worse
 *   than useless — they take up space on the board — so the caller can drop
 *   those too.
 */

/**
 * Overpass endpoints, tried in order. The main instance returns 504 fairly
 * often under load, and the failure is almost always transient, so a retry
 * across mirrors matters more here than picking the "right" host.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Bounding box: south, west, north, east — greater London, Ontario. */
const LONDON_ON_BBOX = [42.83, -81.45, 43.07, -81.09] as const;

/**
 * OSM tag filters per group. Each entry becomes one Overpass clause.
 * Keeping these explicit means the team can see exactly what gets pulled.
 */
const GROUP_FILTERS: Record<
  ScrapeGroup,
  { filters: string[]; category: string; industry: string }
> = {
  local_business: {
    filters: [
      'shop~"^(bakery|butcher|clothes|books|florist|gift|hairdresser|jewelry|shoes|sports|toys|coffee|deli|greengrocer)$"',
      'amenity~"^(cafe|restaurant|bar|pub|fast_food|ice_cream)$"',
      'leisure~"^(fitness_centre|sports_centre)$"',
    ],
    category: "small_business",
    industry: "Local retail and hospitality",
  },
  corporate: {
    filters: [
      'office~"^(company|insurance|financial|estate_agent|it|consulting|lawyer|accountant|engineer)$"',
      'amenity~"^(bank)$"',
      'building="commercial"][name',
    ],
    category: "corporate",
    industry: "Professional services",
  },
  nonprofit: {
    filters: [
      'office~"^(charity|ngo|association|foundation)$"',
      'amenity~"^(social_facility|community_centre|social_centre)$"',
      'amenity="place_of_worship"',
    ],
    category: "nonprofit",
    industry: "Community and nonprofit",
  },
  supplier: {
    filters: [
      'shop~"^(supermarket|convenience|wholesale|chemist|department_store|variety_store|hardware|doityourself)$"',
      'amenity~"^(pharmacy)$"',
    ],
    category: "supplier",
    industry: "Retail supply and grocery",
  },
};

export type ScrapedLead = {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  category: string;
  industry: string;
  location: string;
  source: string;
  notes: string | null;
  /**
   * Scraper-side tags the sponsors table has no column for.
   * scope is "local" or "chain"; chains also carry brand and locations.
   */
  custom_fields: Record<string, string>;
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function buildQuery(groups: ScrapeGroup[], limit: number) {
  const bbox = LONDON_ON_BBOX.join(",");
  const clauses = groups
    .flatMap((g) => GROUP_FILTERS[g].filters)
    .flatMap((f) => [
      `node["name"][${f}](${bbox});`,
      `way["name"][${f}](${bbox});`,
    ])
    .join("\n  ");

  // Overshoot, because screening out chains and unreachable leads throws
  // away most of what comes back. Not without limit though: measured against
  // the live API, a 500-element answer comes back in about 13 seconds while
  // 1200 gets refused with a 504 every time. 500 is roughly 400 distinct
  // businesses, which is more than any single run needs.
  return `[out:json][timeout:60];
(
  ${clauses}
);
out tags center ${Math.min(Math.max(limit * 4, 250), 500)};`;
}

/**
 * Exact tag value -> group, built once from the filters above.
 *
 * This has to be exact rather than substring: office=it would otherwise
 * match "community_centre" and file every community centre as corporate.
 * First group to claim a value wins, matching the declaration order.
 */
const VALUE_TO_GROUP: Map<string, ScrapeGroup> = (() => {
  const map = new Map<string, ScrapeGroup>();
  for (const [group, cfg] of Object.entries(GROUP_FILTERS) as [
    ScrapeGroup,
    (typeof GROUP_FILTERS)[ScrapeGroup],
  ][]) {
    for (const filter of cfg.filters) {
      // Enumerated form: key~"^(a|b|c)$"
      const enumerated = filter.match(/\^\(([^)]+)\)\$/);
      if (enumerated) {
        for (const value of enumerated[1].split("|")) {
          if (!map.has(value)) map.set(value, group);
        }
        continue;
      }
      // Single value form: key="value"
      const single = filter.match(/=\s*"([^"]+)"/);
      if (single && !map.has(single[1])) map.set(single[1], group);
    }
  }
  return map;
})();

function groupOf(tags: Record<string, string>): ScrapeGroup {
  for (const key of ["shop", "amenity", "office", "leisure"] as const) {
    const value = tags[key];
    const group = value ? VALUE_TO_GROUP.get(value) : undefined;
    if (group) return group;
  }
  return "local_business";
}

function normalizeWebsite(raw?: string) {
  if (!raw) return null;
  const url = raw.trim();
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function addressOf(tags: Record<string, string>) {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"] ?? "London",
    "ON",
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * Runs the query against each endpoint in turn and returns the first
 * successful response.
 *
 * Overpass rate limits per IP hard: measured against the live API, roughly
 * two quick requests succeed and then it refuses for about a minute, with
 * either a 429 or a 504 depending on which limit was hit. Retrying fast
 * makes that worse, so both get a pause rather than an immediate retry.
 *
 * The main instance is tried twice in a row before we start hopping. The
 * mirrors are frequently unreachable — both were timing out entirely when
 * this was last measured — so waiting out the main instance beats spending
 * a minute of the request's budget discovering that again.
 */
async function runOverpass(query: string): Promise<OverpassElement[]> {
  const [main, ...mirrors] = OVERPASS_ENDPOINTS;
  const attempts = [main, main, ...mirrors, main];
  let lastError = "";
  let rateLimited = false;

  for (let i = 0; i < attempts.length; i++) {
    let throttled = false;

    try {
      const res = await fetch(attempts[i], {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "BeTheGoodUWO-SponsorPipeline/1.0 (student nonprofit)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const json = (await res.json()) as { elements?: OverpassElement[] };
        return json.elements ?? [];
      }

      // 429 is an explicit rate limit, 504 usually means the same thing
      // under load. Both want patience rather than another request.
      throttled = res.status === 429 || res.status === 504;
      rateLimited ||= throttled;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }

    if (i < attempts.length - 1) {
      await new Promise((r) => setTimeout(r, throttled ? 15_000 : 1500));
    }
  }

  throw new Error(
    rateLimited
      ? "OpenStreetMap is rate limiting us right now. Give it about a minute and press Find leads again."
      : `Could not reach OpenStreetMap (${lastError}). Check your connection and try again.`,
  );
}

/**
 * How many distinct addresses each business name occupies in the search area.
 *
 * OSM very often carries both a node (the shop) and a way (the building it
 * sits in) for the same storefront, so counting elements would call almost
 * everything a chain. Rounding the coordinates to three decimals — a little
 * over 100 metres — collapses those pairs while still keeping two real
 * branches on opposite sides of town apart.
 */
function countLocations(elements: OverpassElement[]) {
  const places = new Map<string, Set<string>>();

  for (const el of elements) {
    const name = el.tags?.name?.trim();
    if (!name) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const spot =
      lat != null && lon != null
        ? `${lat.toFixed(3)},${lon.toFixed(3)}`
        : `el-${el.type}/${el.id}`;

    const key = normalizeName(name);
    const set = places.get(key) ?? new Set<string>();
    set.add(spot);
    places.set(key, set);
  }

  return new Map([...places].map(([name, spots]) => [name, spots.size]));
}

export type LeadScreen = {
  /** Drop anything that looks like a branch of a chain. */
  localOnly?: boolean;
};

export type LeadHarvest = {
  leads: ScrapedLead[];
  /** Named businesses seen before screening. */
  scanned: number;
  /** How many were dropped for being a chain. */
  chainsSkipped: number;
};

export async function fetchOsmLeads(
  groups: ScrapeGroup[],
  limit: number,
  screen: LeadScreen = {},
): Promise<LeadHarvest> {
  const elements = await runOverpass(buildQuery(groups, limit));
  const locationCounts = countLocations(elements);

  const seen = new Set<string>();
  const leads: ScrapedLead[] = [];
  let scanned = 0;
  let chainsSkipped = 0;

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) continue;

    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    scanned += 1;

    const group = groupOf(tags);
    if (!groups.includes(group)) continue;

    const verdict = classifyLead(name, tags, locationCounts.get(key) ?? 1);
    if (verdict.chain && screen.localOnly) {
      chainsSkipped += 1;
      continue;
    }

    const email =
      tags.email ?? tags["contact:email"] ?? tags["contact:e-mail"] ?? null;
    const website = normalizeWebsite(
      tags.website ?? tags["contact:website"] ?? tags.url,
    );

    leads.push({
      name,
      email: email?.toLowerCase() ?? null,
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      website,
      category: normalizeCategory(GROUP_FILTERS[group].category),
      industry:
        tags.cuisine ?? tags.shop ?? tags.office ?? GROUP_FILTERS[group].industry,
      location: addressOf(tags),
      source: "osm",
      notes: verdict.chain
        ? `Found via OpenStreetMap (${el.type}/${el.id}). Looks like a chain: ${verdict.reason}. Sponsorship asks usually have to go through their head office.`
        : `Found via OpenStreetMap (${el.type}/${el.id}). Single location in the London area.`,
      custom_fields: verdict.chain
        ? {
            scope: "chain",
            brand: verdict.brand,
            locations: String(verdict.locations),
          }
        : { scope: "local", locations: "1" },
    });

    if (leads.length >= limit) break;
  }

  return { leads, scanned, chainsSkipped };
}

/* ── Email discovery ─────────────────────────────────────────────────── */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const STRICT_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;

/** Addresses that are never a real contact, or that we should not email. */
const JUNK = [
  "example.com",
  "example.org",
  "yourdomain",
  "domain.com",
  "email.com",
  "your@",
  "yourname@",
  "youremail@",
  "name@email",
  "someone@",
  "test@test",
  // Vendor and CDN addresses that show up in markup and inline scripts.
  "sentry.io",
  "wixpress.com",
  "godaddy.com",
  "squarespace.com",
  "shopify.com",
  "wordpress.com",
  "jsdelivr",
  "unpkg.com",
  "googleapis",
  "gstatic",
  "bootstrapcdn",
  "fontawesome",
  "cloudflare",
  "w3.org",
  "schema.org",
  "@2x",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".css",
  ".js",
  "noreply",
  "no-reply",
  "donotreply",
  "unsubscribe@",
  "abuse@",
  "postmaster@",
];

/** Mailboxes a business reads, as opposed to one person's inbox. */
const ROLE_PREFIXES = [
  "info@",
  "hello@",
  "contact@",
  "office@",
  "admin@",
  "sales@",
  "manager@",
  "events@",
  "marketing@",
  "inquiry@",
  "enquiries@",
  "general@",
  "reception@",
  "bookings@",
  "orders@",
];

const FREE_MAIL = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.ca",
  "outlook.com",
  "live.com",
  "live.ca",
  "yahoo.com",
  "yahoo.ca",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "rogers.com",
  "sympatico.ca",
  "bell.net",
  "shaw.ca",
  "telus.net",
];

/** Last two labels, which is close enough for the .com/.ca names we see. */
function registrableDomain(host: string) {
  return host.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
}

export type EmailPick = { email: string; offDomain: boolean };

/**
 * Chooses which address on a page is the business's own.
 *
 * The trap here is the footer credit. The Well London's site lists
 * jade@graffitidigital.ca — their web designer, not them — and emailing a
 * design agency about sponsoring a student nonprofit helps nobody. But a
 * blanket "must match the site's domain" rule would also throw away
 * billysdelirestaurant@gmail.com, which is exactly right for a deli.
 *
 * So addresses are ranked by whose mailbox they plausibly are:
 *   1. on the site's own domain
 *   2. on a consumer mail provider, which small businesses use constantly
 *   3. a role address on some third party's domain — sister restaurants do
 *      share an inbox, so it is kept, but flagged for a human to confirm
 * A personal-looking address on someone else's domain is dropped: that is
 * the footer-credit shape, and a wrong contact is worse than an empty one.
 */
function pickBestEmail(candidates: string[], siteHost: string) {
  const clean = [
    ...new Set(
      candidates
        .map((e) => e.trim().toLowerCase().replace(/[.,;:)\]]+$/, ""))
        .filter((e) => STRICT_EMAIL_RE.test(e))
        .filter((e) => !JUNK.some((j) => e.includes(j))),
    ),
  ];
  if (!clean.length) return null;

  const site = registrableDomain(siteHost);
  const tierOf = (email: string) => {
    const domain = registrableDomain(email.split("@")[1] ?? "");
    if (domain === site) return 1;
    if (FREE_MAIL.includes(domain)) return 2;
    if (ROLE_PREFIXES.some((p) => email.startsWith(p))) return 3;
    return 4;
  };

  const ranked = clean
    .map((email) => ({ email, tier: tierOf(email) }))
    .filter((c) => c.tier < 4)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      // Inside a tier, a role mailbox beats a named one.
      const aRole = ROLE_PREFIXES.findIndex((p) => a.email.startsWith(p));
      const bRole = ROLE_PREFIXES.findIndex((p) => b.email.startsWith(p));
      return (aRole < 0 ? 99 : aRole) - (bRole < 0 ? 99 : bRole);
    });

  const best = ranked[0];
  return best ? { email: best.email, offDomain: best.tier === 3 } : null;
}

type Page = { $: cheerio.CheerioAPI; html: string };

/**
 * Pulls every address out of a page: mailto links first, then the raw HTML.
 *
 * Scanning the markup rather than the rendered text is deliberate, and both
 * halves of that matter. Small businesses overwhelmingly sit on Squarespace,
 * Wix, and Shopify, which stash the contact address in a JSON blob inside a
 * script tag — London Food Bank's homepage carries info@londonfoodbank.ca
 * exactly there, and reading only the body text found nothing at all.
 *
 * Markup also keeps neighbouring text apart. Cheerio's .text() concatenates
 * adjacent nodes with no separator, which on Covent Market's page produced
 * "1C5519-439-3921info@coventmarket.com" — a phone number welded to the
 * front of a real address. Tags break that up for free.
 */
function emailsOn(page: Page) {
  const { $, html } = page;

  const fromLinks = $('a[href^="mailto:" i]')
    .map((_, el) => {
      const href = ($(el).attr("href") ?? "").replace(/^mailto:/i, "").split("?")[0];
      try {
        return decodeURIComponent(href);
      } catch {
        return href;
      }
    })
    .get();

  const fromMarkup = html.match(EMAIL_RE) ?? [];

  return [...fromLinks, ...fromMarkup].filter(Boolean);
}

async function loadPage(url: string, timeoutMs: number): Promise<Page | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; BeTheGoodUWO-SponsorPipeline/1.0; student nonprofit outreach)",
        accept: "text/html",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });

    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;

    const html = (await res.text()).slice(0, 400_000);
    return { $: cheerio.load(html), html };
  } catch {
    // Dead domain, TLS error, timeout: nothing to read here.
    return null;
  }
}

const CONTACT_HINT = /contact|about|reach|connect|get.?in.?touch|nous.?joindre/i;

/**
 * Homepage first, then up to three contact-ish pages.
 *
 * Which pages those are is mostly decided by the site itself: we read the
 * homepage nav for links whose text or URL mentions contact or about, which
 * beats guessing paths on sites that use /connect or /our-story. The usual
 * guesses are appended as a fallback for when the homepage did not load.
 */
async function findEmailForSite(website: string, stopAt: number) {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return null;
  }

  const home = await loadPage(base.toString(), 7000);
  if (home) {
    const best = pickBestEmail(emailsOn(home), base.host);
    if (best) return { ...best, page: base.toString() };
  }

  const pages = new Set<string>();
  if (home) {
    const $ = home.$;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text();
      if (!CONTACT_HINT.test(href) && !CONTACT_HINT.test(text)) return;
      try {
        const url = new URL(href, base);
        url.hash = "";
        if (url.host === base.host && url.protocol.startsWith("http")) {
          pages.add(url.toString());
        }
      } catch {
        // Relative junk like "javascript:void(0)". Skip it.
      }
    });
  }
  for (const path of ["/contact", "/contact-us", "/about", "/about-us"]) {
    try {
      pages.add(new URL(path, base).toString());
    } catch {
      // Malformed base; the homepage attempt already covered what we can do.
    }
  }
  pages.delete(base.toString());

  let tried = 0;
  for (const page of pages) {
    if (tried >= 3 || Date.now() > stopAt) break;
    tried += 1;

    const doc = await loadPage(page, 6000);
    if (!doc) continue;

    const best = pickBestEmail(emailsOn(doc), base.host);
    if (best) return { ...best, page };
  }

  return null;
}

/**
 * Fills in emails for every lead that has a website but no address on record.
 *
 * Runs a small worker pool rather than one site at a time — the old
 * sequential pass could only get through a few dozen sites before the
 * function timed out, which is most of why the board filled up with leads
 * nobody could email. The whole pass also stops at a wall-clock deadline, so
 * a batch of slow-loading sites can never run the request past its limit.
 */
export async function enrichEmails(
  leads: ScrapedLead[],
  opts: { concurrency?: number; deadlineMs?: number; maxSites?: number } = {},
): Promise<{ leads: ScrapedLead[]; found: number; checked: number }> {
  const { concurrency = 8, deadlineMs = 120_000, maxSites = 250 } = opts;
  if (deadlineMs <= 0) return { leads, found: 0, checked: 0 };

  const targets = leads
    .filter((l) => !l.email && l.website)
    .slice(0, maxSites);
  if (!targets.length) return { leads, found: 0, checked: 0 };

  const stopAt = Date.now() + deadlineMs;
  let next = 0;
  let found = 0;
  let checked = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= targets.length || Date.now() > stopAt) return;

      const lead = targets[i];
      checked += 1;

      const hit = await findEmailForSite(lead.website!, stopAt);
      if (hit) {
        lead.email = hit.email;
        lead.notes = `${lead.notes ?? ""} Email found on ${hit.page}.${
          hit.offDomain
            ? " Heads up: that address is on a different domain than their website, so double check it belongs to them before sending."
            : ""
        }`.trim();
        found += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, worker),
  );

  return { leads, found, checked };
}
