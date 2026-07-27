/**
 * Telling a genuinely local business apart from a branch of a chain.
 *
 * A branch manager at TD or Metro cannot approve a sponsorship — those asks
 * go through a national CSR form, not an email. The leads worth our time are
 * the ones where the person reading the email owns the place. So every
 * scraped lead gets tagged as either a chain or a single-location local
 * business, and the import panel can drop the chains before they ever land.
 *
 * Three signals, cheapest first:
 *   1. OSM brand tags. A mapper set brand= or brand:wikidata= precisely
 *      because the place belongs to a wider brand. Most reliable.
 *   2. A hand-kept list of chains common around London, Ontario, for the
 *      rows where nobody bothered with the brand tag.
 *   3. The same name at two or more distinct addresses inside our search
 *      box. Catches regional chains no list would ever cover.
 */

/**
 * Chains that show up around London, ON. Written the way a person would
 * write them; matching is done on a normalized form so punctuation and
 * casing do not matter.
 */
const KNOWN_CHAINS = [
  // Banks and financial
  "TD", "TD Canada Trust", "BMO", "Bank of Montreal", "RBC", "RBC Royal Bank",
  "Royal Bank of Canada", "Scotiabank", "CIBC", "National Bank", "Desjardins",
  "Tangerine", "Meridian Credit Union", "Libro Credit Union", "HSBC",
  "Simplii Financial", "Easyfinancial", "Money Mart", "Cash Money",
  "H&R Block", "Edward Jones", "Sun Life", "Manulife", "Investors Group",

  // Coffee and quick service
  "Tim Hortons", "Starbucks", "Second Cup", "Country Style", "Coffee Culture",
  "McDonald's", "Subway", "Wendy's", "Burger King", "A&W", "Harvey's", "KFC",
  "Popeyes", "Mary Brown's", "Pizza Pizza", "Pizza Hut", "Domino's",
  "Little Caesars", "Papa John's", "Boston Pizza", "Swiss Chalet",
  "Montana's", "Kelsey's", "East Side Mario's", "The Keg", "Milestones",
  "Jack Astor's", "Moxies", "Chipotle", "Five Guys", "Mucho Burrito",
  "Freshii", "Booster Juice", "Jugo Juice", "Dairy Queen", "Baskin-Robbins",
  "Cold Stone Creamery", "Marble Slab Creamery", "Krispy Kreme", "Cinnabon",
  "Mr. Sub", "Quiznos", "Firehouse Subs", "Panera Bread", "Taco Bell",
  "Osmow's", "Pita Pit", "Extreme Pita", "Wild Wing", "St. Louis Bar and Grill",
  "The Works", "Symposium Cafe", "Denny's", "IHOP", "Ricky's", "Cora",
  "Eggsmart", "Sunset Grill", "Smoke's Poutinerie", "New York Fries",
  "Mr. Greek", "Thai Express", "Manchu Wok", "Edo Japan", "Teriyaki Experience",

  // Grocery, pharmacy, convenience, fuel
  "Metro", "Loblaws", "No Frills", "Real Canadian Superstore", "Zehrs",
  "Sobeys", "FreshCo", "Food Basics", "Farm Boy", "Longo's", "Costco",
  "Walmart", "Shoppers Drug Mart", "Rexall", "Pharmasave", "Guardian Pharmacy",
  "I.D.A.", "Circle K", "7-Eleven", "Mac's", "Hasty Market", "Petro-Canada",
  "Esso", "Shell", "Ultramar", "Husky", "Pioneer", "Canadian Tire Gas+",
  "Bulk Barn", "LCBO", "The Beer Store", "Wine Rack", "M&M Food Market",
  "Nations Fresh Foods", "Giant Tiger", "Dollarama", "Dollar Tree",

  // Retail
  "Canadian Tire", "Home Depot", "Lowe's", "Rona", "Home Hardware",
  "Princess Auto", "Winners", "Marshalls", "HomeSense", "Best Buy", "Staples",
  "Indigo", "Chapters", "Coles", "Sport Chek", "Mark's", "Old Navy", "Gap",
  "H&M", "Zara", "Uniqlo", "Lululemon", "Ardene", "Bootlegger", "Reitmans",
  "Sleep Country", "The Brick", "Leon's", "Structube", "IKEA", "Michaels",
  "PetSmart", "Pet Valu", "Petland", "Sherwin-Williams", "Benjamin Moore",
  "Bath & Body Works", "Sephora", "Claire's", "Foot Locker", "Payless",
  "Aldo", "Roots", "Hudson's Bay", "Value Village", "Talize",

  // Fitness, salons, services
  "GoodLife Fitness", "Anytime Fitness", "Planet Fitness", "Orangetheory",
  "F45 Training", "LA Fitness", "Movati Athletic", "Snap Fitness",
  "Great Clips", "Supercuts", "First Choice Haircutters", "Sport Clips",
  "Regis", "Chatters", "Tommy Gun's",

  // Telecom and shipping
  "Bell", "Rogers", "Telus", "Fido", "Koodo", "Virgin Plus", "Freedom Mobile",
  "Chatr", "The Source", "The UPS Store", "FedEx", "Purolator", "Canada Post",
  "DHL",

  // Automotive and rental
  "Enterprise Rent-A-Car", "Budget Car Rental", "Hertz", "Avis", "Discount Car",
  "Midas", "Mr. Lube", "Jiffy Lube", "Kal Tire", "OK Tire", "Speedy Auto Service",
  "Active Green+Ross", "Fountain Tire", "NAPA Auto Parts", "Carquest",
  "PartSource", "Mr. Transmission", "CAA",

  // Hotels
  "Holiday Inn", "Best Western", "Comfort Inn", "Hampton Inn", "Marriott",
  "Delta Hotels", "Days Inn", "Super 8", "Travelodge", "Quality Inn",
  "Four Points", "Homewood Suites", "Staybridge Suites",
];

/**
 * "Tim Hortons #1234" and "TIM HORTON'S" both collapse to "tim hortons".
 *
 * NFD splits accented letters into a base letter plus a combining mark, and
 * the alphanumeric filter then drops the mark, so "Café Vert" and "Cafe Vert"
 * land on the same key.
 *
 * Apostrophes are deleted rather than turned into a space, so that
 * "Tim Horton's" collapses onto "tim hortons" instead of splitting into
 * "tim horton s" and missing the list entirely.
 */
export function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/['‘’ʼ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** normalized form -> the display spelling we want on the tag. */
const CHAIN_LOOKUP = new Map(
  KNOWN_CHAINS.map((c) => [normalizeName(c), c] as const),
);

/**
 * Matches the name against the known list.
 *
 * Exact match always counts. A prefix match only counts for names long
 * enough to be unambiguous — otherwise "Gap" would flag "Gap Year Cafe" and
 * "Bell" would flag "Bell Tower Bistro".
 */
export function knownChain(name: string): string | null {
  const n = normalizeName(name);
  if (!n) return null;

  const exact = CHAIN_LOOKUP.get(n);
  if (exact) return exact;

  for (const [key, display] of CHAIN_LOOKUP) {
    if (key.length >= 8 && n.startsWith(`${key} `)) return display;
  }
  return null;
}

export type ChainVerdict =
  | { chain: true; brand: string; locations: number; reason: string }
  | { chain: false; locations: 1 };

/**
 * @param locations how many distinct addresses in the search area share this
 *   name. One means we only ever saw it once.
 */
export function classifyLead(
  name: string,
  tags: Record<string, string>,
  locations: number,
): ChainVerdict {
  const brandTag = tags.brand?.trim();
  if (brandTag) {
    return {
      chain: true,
      brand: brandTag,
      locations,
      reason: "tagged with a brand in OpenStreetMap",
    };
  }

  if (tags["brand:wikidata"]) {
    return {
      chain: true,
      brand: name,
      locations,
      reason: "linked to a national brand in OpenStreetMap",
    };
  }

  const known = knownChain(name);
  if (known) {
    return {
      chain: true,
      brand: known,
      locations,
      reason: "matches a known chain",
    };
  }

  if (locations > 1) {
    return {
      chain: true,
      brand: name,
      locations,
      reason: `${locations} locations in the London area`,
    };
  }

  return { chain: false, locations: 1 };
}
