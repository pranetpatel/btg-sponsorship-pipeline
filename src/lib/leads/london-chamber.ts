import * as cheerio from "cheerio";
import type { DiscoveredLead } from "./types";

/**
 * London Chamber of Commerce member directory.
 *
 * Worth having for a reason the other sources cannot supply: everyone here
 * pays annual dues to a business association. That is a filter for
 * businesses with a marketing budget and a habit of saying yes to community
 * asks, which is most of what sponsorship outreach is looking for.
 *
 * Their platform (GrowthZone/ChamberMaster) does not publish member email
 * addresses — contact goes through a form — so this source supplies name,
 * address, phone, and website, and the email crawler does the rest.
 *
 * Shape of the crawl. Their directory offers two indexes and this uses
 * both, because neither alone is sufficient:
 *
 *   /list/searchalpha/{0-9,a..z}  every member, but no category
 *   /list/ql/{category}           categorised, but only members who have one
 *
 * The alphabetical pages decide who exists, the category pages decide what
 * they are. Neither paginates — the result counter on each page matches the
 * number of cards exactly — so one request per index page is a full read.
 * The website then lives only on the individual member page, making this
 * 27 + 22 + N requests, which is why it belongs in an offline job.
 */

const BASE = "https://business.londonchamber.com";
const LIST_URL = `${BASE}/list`;

const USER_AGENT =
  "Mozilla/5.0 (compatible; BeTheGoodUWO-SponsorPipeline/1.0; student nonprofit outreach)";

/** Their category slugs mapped onto our sponsor categories. */
const CATEGORY_MAP: [RegExp, string][] = [
  [/restaurant|food|catering|hospitality|brew/i, "small_business"],
  [/retail|shopping|store/i, "small_business"],
  [/health|wellness|fitness|salon|spa|personal/i, "small_business"],
  [/non-?profit|charity|community|association|social|religio/i, "nonprofit"],
  [/manufactur|wholesale|distribut|supply|agriculture/i, "supplier"],
];

function categorize(slug: string | null) {
  for (const [pattern, category] of CATEGORY_MAP) {
    if (slug && pattern.test(slug)) return category;
  }
  // The bulk of chamber membership is professional services.
  return "corporate";
}

/** Turns "advertising-media-299" into "Advertising media". */
function prettyCategory(slug: string | null) {
  const words = (slug ?? "").replace(/-\d+$/, "").replace(/-/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

async function loadHtml(url: string, timeoutMs = 25_000) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return cheerio.load(await res.text());
  } catch {
    return null;
  }
}

/** Runs `work` over `items` with a bounded number in flight at once. */
async function pool<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = [];
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

type CardMember = {
  slug: string;
  name: string;
  phone: string | null;
  location: string | null;
  categorySlug: string | null;
};

function parseCards(
  $: cheerio.CheerioAPI,
  categorySlug: string | null,
): CardMember[] {
  const members: CardMember[] = [];

  $("div.gz-list-card-wrapper").each((_, el) => {
    const card = $(el);
    const link = card.find('a[href*="/list/member/"]').first().attr("href") ?? "";
    const slug = link.match(/\/list\/member\/([^/?#]+)/)?.[1];
    if (!slug) return;

    const name = card.find(".gz-card-title").first().text().trim();
    if (!name) return;

    const phone =
      card
        .find('a[href^="tel:"]')
        .first()
        .attr("href")
        ?.replace(/^tel:/i, "")
        .trim() ?? null;

    const street = card
      .find(".gz-street-address")
      .map((__, s) => $(s).text().trim())
      .get()
      .filter(Boolean)
      .join(", ");
    const city = card.find(".gz-address-city").first().text().trim();
    const location = [street, city || "London", "ON"].filter(Boolean).join(", ");

    members.push({ slug, name, phone, location, categorySlug });
  });

  return members;
}

/**
 * The roster: every member, with everything the listing pages publish.
 *
 * Deliberately stops short of opening each member's own page, because that
 * is 900-odd extra requests and will not fit in one serverless invocation.
 * Websites are filled in afterwards by fetchChamberWebsites, a batch at a
 * time, which is why the two halves are separate functions.
 */
export async function fetchChamberRoster(
  onProgress?: (message: string) => void,
  options: { concurrency?: number; maxMembers?: number } = {},
): Promise<DiscoveredLead[]> {
  const { concurrency = 6, maxMembers = 5000 } = options;

  onProgress?.("fetching the Chamber directory index");
  const index = await loadHtml(LIST_URL, 40_000);
  if (!index) throw new Error("Could not load the Chamber directory index");

  const categorySlugs = [
    ...new Set(
      index("a[href*='/list/ql/']")
        .map((_, a) => index(a).attr("href") ?? "")
        .get()
        .map((href) => href.match(/\/list\/ql\/([^/?#]+)/)?.[1])
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ];

  const alphaKeys = ["0-9", ..."abcdefghijklmnopqrstuvwxyz"];
  onProgress?.(
    `reading ${alphaKeys.length} alphabetical pages and ${categorySlugs.length} categories`,
  );

  const [alphaPages, categoryPages] = await Promise.all([
    pool(alphaKeys, concurrency, async (key) => {
      const $ = await loadHtml(`${BASE}/list/searchalpha/${key}`, 40_000);
      return $ ? parseCards($, null) : [];
    }),
    pool(categorySlugs, concurrency, async (slug) => {
      const $ = await loadHtml(`${BASE}/list/ql/${slug}`, 40_000);
      return $ ? parseCards($, slug) : [];
    }),
  ]);

  // One member can sit in several categories; the first one seen wins.
  const categoryOf = new Map<string, string>();
  for (const members of categoryPages) {
    for (const member of members) {
      if (member.categorySlug && !categoryOf.has(member.slug)) {
        categoryOf.set(member.slug, member.categorySlug);
      }
    }
  }

  // The alphabetical pages are the roster; categories only annotate it.
  const byMember = new Map<string, CardMember>();
  for (const members of [...alphaPages, ...categoryPages]) {
    for (const member of members) {
      if (!byMember.has(member.slug)) {
        byMember.set(member.slug, {
          ...member,
          categorySlug: categoryOf.get(member.slug) ?? null,
        });
      }
    }
  }

  const members = [...byMember.values()].slice(0, maxMembers);
  onProgress?.(`found ${members.length} Chamber members`);

  return members.map((member) => ({
    source: "london_chamber" as const,
    sourceRef: member.slug,
    name: member.name,
    // GrowthZone keeps member emails behind a contact form.
    email: null,
    phone: member.phone,
    // Filled in later, one member page at a time.
    website: null,
    location: member.location,
    category: categorize(member.categorySlug),
    industry: prettyCategory(member.categorySlug),
    confidence: null,
    brand: null,
    notes: "London Chamber of Commerce member.",
  }));
}

/**
 * Opens individual member pages to pick up their websites.
 *
 * Returns an entry for every slug asked about, website or not, so the caller
 * can mark all of them as checked — otherwise the members who genuinely have
 * no website would be re-fetched on every single run, forever.
 */
export async function fetchChamberWebsites(
  slugs: string[],
  options: { concurrency?: number; deadlineMs?: number } = {},
  onProgress?: (message: string) => void,
): Promise<{ slug: string; website: string | null }[]> {
  const { concurrency = 6, deadlineMs = 120_000 } = options;
  if (!slugs.length) return [];

  const stopAt = Date.now() + deadlineMs;
  const done: { slug: string; website: string | null }[] = [];
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= slugs.length || Date.now() > stopAt) return;

      const slug = slugs[i];
      const $ = await loadHtml(`${BASE}/list/member/${slug}`, 15_000);
      const href = $?.("li.gz-card-website a[href]").first().attr("href");

      done.push({ slug, website: href?.trim() || null });
      if (done.length % 100 === 0) {
        onProgress?.(`  ${done.length}/${slugs.length} member pages`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, slugs.length) }, worker),
  );

  return done;
}
