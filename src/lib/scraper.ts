import * as cheerio from "cheerio";
import { normalizeCategory } from "./sponsors";
import type { ScrapeGroup } from "./scrape-groups";

export type { ScrapeGroup };

/**
 * Lead discovery for the London, Ontario area.
 *
 * Source is the OpenStreetMap Overpass API: open data, no API key, and no
 * terms-of-service problem the way scraping Google or Yellow Pages would be.
 * OSM gives us name, phone, website, and sometimes a contact email directly.
 *
 * When a business has a website but no email on record, we optionally fetch
 * its homepage and contact page and pull the first mailto/plain-text address.
 * That pass is rate limited and best effort: a miss just means the row lands
 * with a website and no email, which the team can fill in by hand.
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
};

type OverpassElement = {
  type: string;
  id: number;
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

  return `[out:json][timeout:60];
(
  ${clauses}
);
out tags center ${Math.min(limit * 3, 900)};`;
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
 * two quick requests succeed and then it returns 429 for about a minute.
 * Retrying fast makes that worse, so a 429 gets a long pause rather than an
 * immediate hop to the next host. One scrape run is one request, so a team
 * doing this a few times a day never notices.
 */
async function runOverpass(query: string): Promise<OverpassElement[]> {
  const attempts = [...OVERPASS_ENDPOINTS, ...OVERPASS_ENDPOINTS];
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
        signal: AbortSignal.timeout(45_000),
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
      await new Promise((r) => setTimeout(r, throttled ? 20_000 : 1500));
    }
  }

  throw new Error(
    rateLimited
      ? "OpenStreetMap is rate limiting us right now. Give it about a minute and press Find leads again."
      : `Could not reach OpenStreetMap (${lastError}). Check your connection and try again.`,
  );
}

export async function fetchOsmLeads(
  groups: ScrapeGroup[],
  limit: number,
): Promise<ScrapedLead[]> {
  const elements = await runOverpass(buildQuery(groups, limit));
  const seen = new Set<string>();
  const leads: ScrapedLead[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const group = groupOf(tags);
    if (!groups.includes(group)) continue;

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
      notes: `Found via OpenStreetMap (${el.type}/${el.id}).`,
    });

    if (leads.length >= limit) break;
  }

  return leads;
}

/* ── Email discovery ─────────────────────────────────────────────────── */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Addresses that are never a real contact, or that we should not email. */
const JUNK = [
  "example.com",
  "sentry.io",
  "wixpress.com",
  "godaddy.com",
  "squarespace.com",
  "@2x",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  "noreply",
  "no-reply",
  "donotreply",
];

function pickBestEmail(candidates: string[]) {
  const clean = candidates
    .map((e) => e.toLowerCase())
    .filter((e) => !JUNK.some((j) => e.includes(j)));

  if (!clean.length) return null;

  // Prefer a general inbox over a personal one, and either over anything else.
  const preferred = ["info@", "hello@", "contact@", "office@", "admin@"];
  for (const p of preferred) {
    const hit = clean.find((e) => e.startsWith(p));
    if (hit) return hit;
  }
  return clean[0];
}

async function scrapePage(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; BeTheGoodUWO-SponsorPipeline/1.0; student nonprofit outreach)",
      accept: "text/html",
    },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });

  if (!res.ok) return [];
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) return [];

  const html = (await res.text()).slice(0, 400_000);
  const $ = cheerio.load(html);

  const fromLinks = $('a[href^="mailto:"]')
    .map((_, el) => ($(el).attr("href") ?? "").replace(/^mailto:/i, "").split("?")[0])
    .get();

  const fromText = $("body").text().match(EMAIL_RE) ?? [];

  return [...fromLinks, ...fromText].filter(Boolean);
}

/**
 * Best-effort email lookup for leads that have a website but no email.
 * Sequential with a small delay so we stay a polite visitor.
 */
export async function enrichEmails(
  leads: ScrapedLead[],
  budget: number,
): Promise<{ leads: ScrapedLead[]; found: number }> {
  let found = 0;
  let spent = 0;

  for (const lead of leads) {
    if (lead.email || !lead.website || spent >= budget) continue;
    spent += 1;

    try {
      const base = new URL(lead.website);
      const candidates = [
        base.toString(),
        new URL("/contact", base).toString(),
        new URL("/contact-us", base).toString(),
      ];

      for (const page of candidates) {
        const emails = await scrapePage(page);
        const best = pickBestEmail(emails);
        if (best) {
          lead.email = best;
          lead.notes = `${lead.notes ?? ""} Email found on ${page}.`.trim();
          found += 1;
          break;
        }
      }
    } catch {
      // Dead domain, TLS error, timeout: leave the lead without an email.
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  return { leads, found };
}
