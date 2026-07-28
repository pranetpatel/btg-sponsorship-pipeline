/**
 * Client-safe options for the "Add sponsors" panel. Kept apart from the
 * lead modules so the browser bundle never pulls in cheerio or DuckDB.
 */

/**
 * The bar a lead has to clear on contact info before it is worth a card on
 * the board. Anything below the bar stays in the pool rather than being
 * imported, because a row with no email and no phone is just noise to
 * scroll past.
 */
export type ContactRule = "email" | "email_or_phone" | "any";

export const CONTACT_RULES: {
  value: ContactRule;
  label: string;
  hint: string;
}[] = [
  {
    value: "email",
    label: "Email only",
    hint: "Ready to send to right away",
  },
  {
    value: "email_or_phone",
    label: "Email or phone",
    hint: "Reachable one way or another",
  },
  {
    value: "any",
    label: "Keep everything",
    hint: "Includes leads you'd have to look up yourself",
  },
];

/** Sponsor categories offered as filters when drawing from the pool. */
export type LeadCategory =
  | "small_business"
  | "corporate"
  | "nonprofit"
  | "supplier";

export const LEAD_CATEGORIES: {
  value: LeadCategory;
  label: string;
  hint: string;
}[] = [
  {
    value: "small_business",
    label: "Local businesses",
    hint: "Cafes, restaurants, shops, salons, gyms",
  },
  {
    value: "corporate",
    label: "Corporate",
    hint: "Offices, banks, professional services",
  },
  {
    value: "nonprofit",
    label: "Nonprofits",
    hint: "Charities, community groups, faith groups",
  },
  {
    value: "supplier",
    label: "Suppliers",
    hint: "Grocers, pharmacies, wholesale",
  },
];

/** Mirrors LEAD_SOURCES in src/lib/leads/types.ts, without the server code. */
export type LeadSourceOption = "overture" | "downtown_london" | "london_chamber";

export const LEAD_SOURCE_OPTIONS: {
  value: LeadSourceOption;
  label: string;
  hint: string;
}[] = [
  {
    value: "downtown_london",
    label: "Downtown London BIA",
    hint: "Curated downtown independents, most with an email",
  },
  {
    value: "london_chamber",
    label: "Chamber of Commerce",
    hint: "Dues-paying members, so they have a budget",
  },
  {
    value: "overture",
    label: "Overture Maps",
    hint: "Every business mapped in London, the widest net",
  },
];
