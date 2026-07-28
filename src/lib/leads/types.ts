import { classifyLead, normalizeName } from "@/lib/chains";
import { normalizeCategory } from "@/lib/sponsors";

/**
 * Where a lead came from. Each one is a module under src/lib/leads that
 * knows how to produce DiscoveredLead rows, and nothing else in the app
 * needs to care which is which.
 */
export type LeadSource = "overture" | "downtown_london" | "london_chamber";

export const LEAD_SOURCES: {
  value: LeadSource;
  label: string;
  hint: string;
}[] = [
  {
    value: "overture",
    label: "Overture Maps",
    hint: "Every business mapped in London — the widest net",
  },
  {
    value: "downtown_london",
    label: "Downtown London BIA",
    hint: "Curated downtown independents, most with an email",
  },
  {
    value: "london_chamber",
    label: "Chamber of Commerce",
    hint: "Dues-paying members, so they have a marketing budget",
  },
];

/** What a source hands back, before chain screening and normalization. */
export type DiscoveredLead = {
  source: LeadSource;
  /** Stable id within that source, so refreshes update instead of duplicate. */
  sourceRef: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  category: string;
  industry: string | null;
  confidence: number | null;
  /** Brand the source attached to this place, if it publishes one. */
  brand: string | null;
  notes: string | null;
};

/** A lead_pool row, ready to upsert. */
export type PooledLead = {
  source: string;
  source_ref: string;
  name: string;
  name_key: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  category: string;
  industry: string | null;
  scope: "local" | "chain";
  brand: string | null;
  locations: number;
  confidence: number | null;
  notes: string | null;
};

function tidy(value: string | null | undefined) {
  const s = (value ?? "").trim();
  return s.length ? s : null;
}

function normalizeWebsite(raw: string | null) {
  const url = tidy(raw);
  if (!url) return null;
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

/**
 * Strips the formatting each source invents so duplicates compare equal.
 *
 * Anything that cannot yield ten digits is dropped rather than stored as
 * written. Directories do publish broken numbers — Downtown London has a
 * "(226)y9-4796" where a percent-escape got mangled — and a phone column
 * that might contain junk is one nobody on the team can trust enough to
 * dial. Better an empty cell than a wrong one.
 */
function normalizePhone(raw: string | null) {
  const digits = (tidy(raw) ?? "").replace(/[^\d]/g, "");
  if (digits.length < 10) return null;
  const ten = digits.slice(-10);
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * Turns a source's output into a pool row, applying the chain screen.
 *
 * @param locationCounts how many distinct places share each normalized name,
 *   across everything the source returned. A name at several addresses is a
 *   chain even when no brand field says so.
 */
export function toPooledLead(
  lead: DiscoveredLead,
  locationCounts: Map<string, number>,
): PooledLead {
  const nameKey = normalizeName(lead.name);
  const locations = locationCounts.get(nameKey) ?? 1;
  const verdict = classifyLead(lead.name, { brand: lead.brand }, locations);

  return {
    source: lead.source,
    source_ref: lead.sourceRef,
    name: lead.name.trim(),
    name_key: nameKey,
    email: tidy(lead.email)?.toLowerCase() ?? null,
    phone: normalizePhone(lead.phone),
    website: normalizeWebsite(lead.website),
    location: tidy(lead.location),
    category: normalizeCategory(lead.category),
    industry: tidy(lead.industry),
    scope: verdict.chain ? "chain" : "local",
    brand: verdict.chain ? verdict.brand : null,
    locations: verdict.chain ? verdict.locations : 1,
    confidence: lead.confidence,
    notes: verdict.chain
      ? `${lead.notes ?? ""} Looks like a chain: ${verdict.reason}.`.trim()
      : tidy(lead.notes),
  };
}

/** Counts distinct addresses per name so repeats can be spotted. */
export function countByName(
  leads: DiscoveredLead[],
  placeOf: (lead: DiscoveredLead) => string,
) {
  const places = new Map<string, Set<string>>();
  for (const lead of leads) {
    const key = normalizeName(lead.name);
    if (!key) continue;
    const set = places.get(key) ?? new Set<string>();
    set.add(placeOf(lead));
    places.set(key, set);
  }
  return new Map([...places].map(([name, spots]) => [name, spots.size]));
}
