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
