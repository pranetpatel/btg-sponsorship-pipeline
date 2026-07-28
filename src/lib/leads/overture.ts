import { DuckDBInstance } from "@duckdb/node-api";
import type { DiscoveredLead } from "./types";

/**
 * Overture Maps Places — the bulk source.
 *
 * Overture is the successor to hand-mapped POI data: Meta, Microsoft, and
 * Foursquare pooling their business listings under permissive licences
 * (CDLA-Permissive-2.0 / Apache-2.0 / CC0). Measured over the London
 * bounding box, its contact coverage is not close to what OpenStreetMap
 * had, counting only the independents this pipeline actually keeps:
 *
 *                     OpenStreetMap    Overture
 *   independents          ~256           5,754
 *   has a website          18%             85%
 *   has a phone            17%             94%
 *   has an email            1%             56%
 *
 * A caution for anyone re-running those numbers: `brand` is a struct that
 * is non-null on most rows even when it holds no brand name, so `brand is
 * null` picks out an odd subset and understates the email rate badly (9%
 * rather than 56%). Test `brand.names.primary`, which is what this reads.
 *
 * This is bulk Parquet on S3, not an API — a query takes minutes and moves
 * a lot of data, which is exactly why it belongs in an offline refresh job
 * and not in a request. DuckDB reads it directly over HTTP, pushing the
 * bounding box down into the Parquet row groups so only London is fetched.
 */

/** South, west, north, east — greater London, Ontario. */
const LONDON_ON_BBOX = { xmin: -81.45, ymin: 42.83, xmax: -81.09, ymax: 43.07 };

const S3_BASE = "s3://overturemaps-us-west-2/release";

/**
 * Overture category -> our sponsor category. Their taxonomy is a long tail
 * of specific types (pizza_restaurant, hair_salon, ...), so matching is on
 * substrings, most specific first.
 */
const CATEGORY_RULES: [RegExp, string, string][] = [
  [/bank|credit_union|financial|insurance|accounting|legal|lawyer|real_estate|corporate_office|professional_services|consulting|advertising|marketing/, "corporate", "Professional services"],
  [/charity|non_profit|nonprofit|community|religious|church|place_of_worship|social_service|library|museum/, "nonprofit", "Community and nonprofit"],
  [/grocery|supermarket|convenience|wholesale|pharmacy|drugstore|building_supply|hardware|department_store|distribution/, "supplier", "Retail supply and grocery"],
  [/restaurant|cafe|coffee|bakery|bar|pub|brewery|food|dessert|ice_cream|salon|spa|barber|gym|fitness|yoga|studio|shop|store|retail|boutique|florist|book/, "small_business", "Local retail and hospitality"],
];

function categorize(primary: string | null) {
  const key = (primary ?? "").toLowerCase();
  for (const [pattern, category, industry] of CATEGORY_RULES) {
    if (pattern.test(key)) return { category, industry };
  }
  return { category: "other", industry: null };
}

/** Turns "pizza_restaurant" into "Pizza restaurant" for the industry field. */
function prettyCategory(primary: string | null) {
  if (!primary) return null;
  const words = primary.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

type Row = {
  id: string;
  name: string | null;
  category: string | null;
  confidence: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  brand: string | null;
  address: string | null;
  locality: string | null;
  lat: number | null;
  lon: number | null;
};

/**
 * Which Overture release to read. They publish roughly monthly and old
 * releases stay up, so pinning is possible, but the default follows
 * whatever is newest.
 */
export async function latestOvertureRelease(): Promise<string> {
  const res = await fetch(
    "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/",
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) throw new Error(`Could not list Overture releases (${res.status})`);

  const xml = await res.text();
  const releases = [...xml.matchAll(/<Prefix>release\/([^<]+?)\/<\/Prefix>/g)]
    .map((m) => m[1])
    .sort();

  const newest = releases.at(-1);
  if (!newest) throw new Error("No Overture releases found");
  return newest;
}

export async function fetchOvertureLeads(
  release: string,
  onProgress?: (message: string) => void,
): Promise<DiscoveredLead[]> {
  const instance = await DuckDBInstance.create(":memory:");
  const db = await instance.connect();

  onProgress?.(`querying Overture ${release} (this pulls a lot of data)`);

  await db.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';");

  const path = `${S3_BASE}/${release}/theme=places/type=place/*`;
  const { xmin, ymin, xmax, ymax } = LONDON_ON_BBOX;

  // Everything except the bbox filter is plain projection: the arrays are
  // flattened to their first entry, since a business with three listed
  // phone numbers is still one business to us.
  const result = await db.runAndReadAll(`
    select
      id,
      names.primary                                        as name,
      categories.primary                                   as category,
      confidence,
      case when len(websites) > 0 then websites[1] end     as website,
      case when len(phones)   > 0 then phones[1]   end     as phone,
      case when len(emails)   > 0 then emails[1]   end     as email,
      brand.names.primary                                  as brand,
      case when len(addresses) > 0 then addresses[1].freeform end as address,
      case when len(addresses) > 0 then addresses[1].locality end as locality,
      bbox.ymin as lat,
      bbox.xmin as lon
    from read_parquet('${path}', hive_partitioning=1)
    where bbox.xmin > ${xmin} and bbox.xmax < ${xmax}
      and bbox.ymin > ${ymin} and bbox.ymax < ${ymax}
      and names.primary is not null
  `);

  const rows = result.getRowObjects() as unknown as Row[];
  db.closeSync();

  onProgress?.(`Overture returned ${rows.length} places`);

  const leads: DiscoveredLead[] = [];
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;

    const { category, industry } = categorize(row.category);
    // Places we would never approach for a sponsorship: ATMs, bus stops,
    // apartment buildings and the like land in "other" with no useful
    // category, and there is no point pooling them.
    if (category === "other") continue;

    leads.push({
      source: "overture",
      sourceRef: row.id,
      name,
      email: row.email,
      phone: row.phone,
      website: row.website,
      location: [row.address, row.locality ?? "London", "ON"]
        .filter(Boolean)
        .join(", "),
      category,
      industry: prettyCategory(row.category) ?? industry,
      confidence: row.confidence == null ? null : Number(row.confidence),
      brand: row.brand,
      notes: `Found in Overture Maps (${release}).`,
    });
  }

  return leads;
}

/** Distinct-address key, so one business mapped twice is not called a chain. */
export function overturePlaceKey(lead: DiscoveredLead) {
  return lead.location ?? lead.sourceRef;
}
