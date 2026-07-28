import * as cheerio from "cheerio";
import type { DiscoveredLead } from "./types";

/**
 * Downtown London BIA business directory.
 *
 * The highest-quality source we have, for two reasons. It is curated — a
 * BIA directory is by definition independent operators inside one set of
 * downtown blocks, so almost nothing here needs chain screening. And its
 * contact coverage beats any map dataset: of the 996 listings, 93% publish
 * a phone number and 28% publish an email outright, against Overture's 9%.
 *
 * The whole directory renders into one page — around 4.5MB of it — so a
 * full refresh is a single request rather than a thousand.
 */

const DIRECTORY_URL = "https://www.downtownlondon.ca/business-directory/";

/** Their service-type labels mapped onto our sponsor categories. */
const CATEGORY_MAP: [RegExp, string][] = [
  [/food|drink|restaurant|cafe/i, "small_business"],
  [/retail|shopping/i, "small_business"],
  [/personal service|salon|spa|health|fitness/i, "small_business"],
  [/professional service|financial|legal|real estate/i, "corporate"],
  [/tourism|attraction|arts|culture/i, "nonprofit"],
];

function categorize(serviceType: string | null) {
  for (const [pattern, category] of CATEGORY_MAP) {
    if (serviceType && pattern.test(serviceType)) return category;
  }
  return "small_business";
}

/** Percent-decodes without throwing on the malformed escapes in their data. */
function decodeLoosely(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Their address lives only inside the Google Maps link, glued onto the
 * business name:
 *
 *   destination=369+Convenience 57+York+St+unit+1%2C+London%2C+ON
 *
 * Note which character does what. Spaces *within* the name and within the
 * address are "+", but the two are separated by a single literal space, and
 * that is the only reliable delimiter — the name cannot be stripped by
 * length because it is HTML-escaped in the URL ("&" becomes "%26%23038%3B",
 * six characters longer than it looks). So the raw parameter has to be read
 * before anything decodes "+" back into spaces, which is why this pulls the
 * value out with a regex rather than using URLSearchParams.
 */
function addressFromMapsLink(href: string, name: string) {
  const raw = href.match(/[?&]destination=([^&"']*)/)?.[1];
  if (!raw) return null;

  const spaceAt = raw.indexOf(" ");
  // No literal space means no address was supplied, only the name.
  if (spaceAt < 0) return null;

  const address = decodeLoosely(raw.slice(spaceAt + 1).replace(/\+/g, " "))
    .trim()
    .replace(/^[,\s]+/, "");

  // A couple of listings repeat the name where the address should be.
  if (!address || address.toLowerCase() === name.toLowerCase()) return null;
  return address;
}

export async function fetchDowntownLondonLeads(
  onProgress?: (message: string) => void,
): Promise<DiscoveredLead[]> {
  onProgress?.("fetching the Downtown London directory");

  const res = await fetch(DIRECTORY_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; BeTheGoodUWO-SponsorPipeline/1.0; student nonprofit outreach)",
      accept: "text/html",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new Error(`Downtown London directory returned ${res.status}`);
  }

  const $ = cheerio.load(await res.text());
  const leads: DiscoveredLead[] = [];

  $("div.business-tile").each((_, el) => {
    const tile = $(el);
    const name = tile.find("h2.business-title").first().text().trim();
    if (!name) return;

    const listingHref =
      tile.find('a[href*="/business-directory/"]').first().attr("href") ?? "";
    const slug =
      listingHref.match(/\/business-directory\/([^/]+)\/?$/)?.[1] ??
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    const serviceType =
      tile.find("span.service-type").first().text().trim() || null;

    let email: string | null = null;
    let phone: string | null = null;
    let website: string | null = null;
    let location: string | null = null;

    tile.find("div.business-links a[href]").each((__, a) => {
      const href = $(a).attr("href") ?? "";

      if (/^mailto:/i.test(href)) {
        email ??= decodeLoosely(
          href.replace(/^mailto:/i, "").split("?")[0],
        ).trim();
      } else if (/^tel:/i.test(href)) {
        // Their tel: links are percent-encoded — "tel:(519)%20439-7888" —
        // and the raw %20 would otherwise survive into the phone column as
        // two stray digits once punctuation is stripped.
        phone ??= decodeLoosely(href.replace(/^tel:/i, "")).trim();
      } else if (href.includes("google.com/maps")) {
        location ??= addressFromMapsLink(href, name);
      } else if (/^https?:/i.test(href)) {
        website ??= href.trim();
      }
    });

    leads.push({
      source: "downtown_london",
      sourceRef: slug,
      name,
      email,
      phone,
      website,
      location: location ?? "London, ON",
      category: categorize(serviceType),
      industry: serviceType,
      confidence: null,
      // A BIA directory is independents by construction. Leaving brand null
      // lets the known-chain list still catch the odd franchise downtown.
      brand: null,
      notes: "Listed in the Downtown London BIA directory.",
    });
  });

  onProgress?.(`Downtown London returned ${leads.length} businesses`);
  return leads;
}
