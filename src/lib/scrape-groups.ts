/**
 * Client-safe half of the scraper config. Lives apart from scraper.ts so the
 * import panel can render the options without pulling cheerio into the
 * browser bundle.
 */
export type ScrapeGroup =
  | "local_business"
  | "corporate"
  | "nonprofit"
  | "supplier";

export const SCRAPE_GROUPS: {
  value: ScrapeGroup;
  label: string;
  hint: string;
}[] = [
  {
    value: "local_business",
    label: "Local businesses",
    hint: "Cafes, restaurants, shops, gyms",
  },
  {
    value: "corporate",
    label: "Corporate",
    hint: "Offices, banks, professional services",
  },
  {
    value: "nonprofit",
    label: "Nonprofits",
    hint: "Charities, community centres, faith groups",
  },
  {
    value: "supplier",
    label: "Suppliers",
    hint: "Grocers, pharmacies, wholesale",
  },
];

/**
 * The bar a lead has to clear on contact info before it is worth a card on
 * the board. Anything below the bar is dropped at import rather than saved,
 * because a row with no email and no phone is just noise to scroll past.
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
