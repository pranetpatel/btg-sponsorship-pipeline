import { supabaseAdmin } from "./supabase/admin";
import type { Sponsor, SponsorWithStats, OutreachLog } from "./types";

/**
 * Loads every sponsor plus a rollup of its outreach history in two queries.
 * The list is small (hundreds, not millions), so rolling up in JS keeps the
 * schema free of views and keeps realtime updates trivial to apply.
 */
export async function listSponsorsWithStats(): Promise<SponsorWithStats[]> {
  const db = supabaseAdmin();

  const [sponsorsRes, logsRes] = await Promise.all([
    db.from("sponsors").select("*").order("created_at", { ascending: false }),
    db
      .from("outreach_logs")
      .select("sponsor_id, sent_at, opened, clicked, response_status")
      .order("sent_at", { ascending: false }),
  ]);

  if (sponsorsRes.error) throw new Error(sponsorsRes.error.message);
  if (logsRes.error) throw new Error(logsRes.error.message);

  const rollup = new Map<
    string,
    Pick<
      SponsorWithStats,
      | "outreach_count"
      | "last_outreach_at"
      | "ever_opened"
      | "ever_clicked"
      | "latest_response"
    >
  >();

  for (const log of (logsRes.data ?? []) as Partial<OutreachLog>[]) {
    const id = log.sponsor_id!;
    const prev = rollup.get(id);
    if (!prev) {
      rollup.set(id, {
        outreach_count: 1,
        // logs are sorted newest first, so the first one we see is the latest
        last_outreach_at: log.sent_at ?? null,
        ever_opened: Boolean(log.opened),
        ever_clicked: Boolean(log.clicked),
        latest_response: log.response_status ?? null,
      });
    } else {
      prev.outreach_count += 1;
      prev.ever_opened ||= Boolean(log.opened);
      prev.ever_clicked ||= Boolean(log.clicked);
    }
  }

  return ((sponsorsRes.data ?? []) as Sponsor[]).map((s) => ({
    ...s,
    outreach_count: rollup.get(s.id)?.outreach_count ?? 0,
    last_outreach_at: rollup.get(s.id)?.last_outreach_at ?? null,
    ever_opened: rollup.get(s.id)?.ever_opened ?? false,
    ever_clicked: rollup.get(s.id)?.ever_clicked ?? false,
    latest_response: rollup.get(s.id)?.latest_response ?? null,
  }));
}

/** Normalizes anything user-supplied (CSV row, scraper hit, form) to a row. */
export function normalizeSponsorInput(raw: Record<string, unknown>) {
  const str = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
    return s.length ? s : null;
  };

  const email = str(raw.email)?.toLowerCase() ?? null;
  const value = raw.potential_value;
  const parsedValue =
    value == null || value === ""
      ? 0
      : Number(String(value).replace(/[^0-9.-]/g, "")) || 0;

  return {
    name: str(raw.name) ?? "Unnamed",
    email,
    phone: str(raw.phone),
    website: str(raw.website),
    category: normalizeCategory(str(raw.category)),
    industry: str(raw.industry),
    location: str(raw.location) ?? "London, ON",
    status: normalizeStatus(str(raw.status)),
    potential_value: parsedValue,
    contact_name: str(raw.contact_name),
    notes: str(raw.notes),
    source: str(raw.source) ?? "manual",
    custom_fields:
      (raw.custom_fields as Record<string, string> | undefined) ?? {},
  };
}

const CATEGORY_ALIASES: Record<string, string> = {
  corporate: "corporate",
  company: "corporate",
  business: "small_business",
  small: "small_business",
  small_business: "small_business",
  "small business": "small_business",
  local: "small_business",
  nonprofit: "nonprofit",
  "non-profit": "nonprofit",
  charity: "nonprofit",
  ngo: "nonprofit",
  supplier: "supplier",
  supply: "supplier",
  vendor: "supplier",
  alumni: "alumni",
  alum: "alumni",
};

export function normalizeCategory(input: string | null) {
  if (!input) return "small_business";
  const key = input.toLowerCase().trim();
  return CATEGORY_ALIASES[key] ?? "other";
}

const STATUS_ALIASES: Record<string, string> = {
  new: "new",
  lead: "new",
  contacted: "contacted",
  emailed: "contacted",
  sent: "contacted",
  interested: "interested",
  warm: "interested",
  committed: "committed",
  confirmed: "committed",
  won: "committed",
  declined: "declined",
  rejected: "declined",
  no: "declined",
  lost: "declined",
};

export function normalizeStatus(input: string | null) {
  if (!input) return "new";
  return STATUS_ALIASES[input.toLowerCase().trim()] ?? "new";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (v: string | null | undefined) =>
  Boolean(v && EMAIL_RE.test(v));
