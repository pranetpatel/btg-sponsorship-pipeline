import * as cheerio from "cheerio";

/**
 * Finding a contact address on a business's own website.
 *
 * Every lead source we have is thin on emails — the best of them publishes
 * one for 28% of listings, the widest for 9% — but nearly all of them carry
 * a website. This turns those websites into addresses, at roughly a 1-in-3
 * rate, which is where most of the pipeline's usable contacts come from.
 *
 * It runs as part of the offline refresh job rather than inside a request,
 * so it can afford to be thorough.
 */

/* ── Email discovery ─────────────────────────────────────────────────── */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const STRICT_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;

/** Addresses that are never a real contact, or that we should not email. */
const JUNK = [
  "example.com",
  "example.org",
  "yourdomain",
  "domain.com",
  "email.com",
  "your@",
  "yourname@",
  "youremail@",
  "name@email",
  "someone@",
  "test@test",
  // Vendor and CDN addresses that show up in markup and inline scripts.
  "sentry.io",
  "wixpress.com",
  "godaddy.com",
  "squarespace.com",
  "shopify.com",
  "wordpress.com",
  "jsdelivr",
  "unpkg.com",
  "googleapis",
  "gstatic",
  "bootstrapcdn",
  "fontawesome",
  "cloudflare",
  "w3.org",
  "schema.org",
  "@2x",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".css",
  ".js",
  "noreply",
  "no-reply",
  "donotreply",
  "unsubscribe@",
  "abuse@",
  "postmaster@",
];

/** Mailboxes a business reads, as opposed to one person's inbox. */
const ROLE_PREFIXES = [
  "info@",
  "hello@",
  "contact@",
  "office@",
  "admin@",
  "sales@",
  "manager@",
  "events@",
  "marketing@",
  "inquiry@",
  "enquiries@",
  "general@",
  "reception@",
  "bookings@",
  "orders@",
];

const FREE_MAIL = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.ca",
  "outlook.com",
  "live.com",
  "live.ca",
  "yahoo.com",
  "yahoo.ca",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "rogers.com",
  "sympatico.ca",
  "bell.net",
  "shaw.ca",
  "telus.net",
];

/** Last two labels, which is close enough for the .com/.ca names we see. */
function registrableDomain(host: string) {
  return host.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
}

export type EmailPick = { email: string; offDomain: boolean };

/**
 * Chooses which address on a page is the business's own.
 *
 * The trap here is the footer credit. The Well London's site lists
 * jade@graffitidigital.ca — their web designer, not them — and emailing a
 * design agency about sponsoring a student nonprofit helps nobody. But a
 * blanket "must match the site's domain" rule would also throw away
 * billysdelirestaurant@gmail.com, which is exactly right for a deli.
 *
 * So addresses are ranked by whose mailbox they plausibly are:
 *   1. on the site's own domain
 *   2. on a consumer mail provider, which small businesses use constantly
 *   3. a role address on some third party's domain — sister restaurants do
 *      share an inbox, so it is kept, but flagged for a human to confirm
 * A personal-looking address on someone else's domain is dropped: that is
 * the footer-credit shape, and a wrong contact is worse than an empty one.
 */
function pickBestEmail(candidates: string[], siteHost: string) {
  const clean = [
    ...new Set(
      candidates
        .map((e) => e.trim().toLowerCase().replace(/[.,;:)\]]+$/, ""))
        .filter((e) => STRICT_EMAIL_RE.test(e))
        .filter((e) => !JUNK.some((j) => e.includes(j))),
    ),
  ];
  if (!clean.length) return null;

  const site = registrableDomain(siteHost);
  const tierOf = (email: string) => {
    const domain = registrableDomain(email.split("@")[1] ?? "");
    if (domain === site) return 1;
    if (FREE_MAIL.includes(domain)) return 2;
    if (ROLE_PREFIXES.some((p) => email.startsWith(p))) return 3;
    return 4;
  };

  const ranked = clean
    .map((email) => ({ email, tier: tierOf(email) }))
    .filter((c) => c.tier < 4)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      // Inside a tier, a role mailbox beats a named one.
      const aRole = ROLE_PREFIXES.findIndex((p) => a.email.startsWith(p));
      const bRole = ROLE_PREFIXES.findIndex((p) => b.email.startsWith(p));
      return (aRole < 0 ? 99 : aRole) - (bRole < 0 ? 99 : bRole);
    });

  const best = ranked[0];
  return best ? { email: best.email, offDomain: best.tier === 3 } : null;
}

type Page = { $: cheerio.CheerioAPI; html: string };

/**
 * Pulls every address out of a page: mailto links first, then the raw HTML.
 *
 * Scanning the markup rather than the rendered text is deliberate, and both
 * halves of that matter. Small businesses overwhelmingly sit on Squarespace,
 * Wix, and Shopify, which stash the contact address in a JSON blob inside a
 * script tag — London Food Bank's homepage carries info@londonfoodbank.ca
 * exactly there, and reading only the body text found nothing at all.
 *
 * Markup also keeps neighbouring text apart. Cheerio's .text() concatenates
 * adjacent nodes with no separator, which on Covent Market's page produced
 * "1C5519-439-3921info@coventmarket.com" — a phone number welded to the
 * front of a real address. Tags break that up for free.
 */
function emailsOn(page: Page) {
  const { $, html } = page;

  const fromLinks = $('a[href^="mailto:" i]')
    .map((_, el) => {
      const href = ($(el).attr("href") ?? "").replace(/^mailto:/i, "").split("?")[0];
      try {
        return decodeURIComponent(href);
      } catch {
        return href;
      }
    })
    .get();

  const fromMarkup = html.match(EMAIL_RE) ?? [];

  return [...fromLinks, ...fromMarkup].filter(Boolean);
}

async function loadPage(url: string, timeoutMs: number): Promise<Page | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; BeTheGoodUWO-SponsorPipeline/1.0; student nonprofit outreach)",
        accept: "text/html",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });

    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;

    const html = (await res.text()).slice(0, 400_000);
    return { $: cheerio.load(html), html };
  } catch {
    // Dead domain, TLS error, timeout: nothing to read here.
    return null;
  }
}

const CONTACT_HINT = /contact|about|reach|connect|get.?in.?touch|nous.?joindre/i;

/**
 * Homepage first, then up to three contact-ish pages.
 *
 * Which pages those are is mostly decided by the site itself: we read the
 * homepage nav for links whose text or URL mentions contact or about, which
 * beats guessing paths on sites that use /connect or /our-story. The usual
 * guesses are appended as a fallback for when the homepage did not load.
 */
export async function findEmailForSite(website: string, stopAt: number) {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return null;
  }

  const home = await loadPage(base.toString(), 7000);
  if (home) {
    const best = pickBestEmail(emailsOn(home), base.host);
    if (best) return { ...best, page: base.toString() };
  }

  const pages = new Set<string>();
  if (home) {
    const $ = home.$;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text();
      if (!CONTACT_HINT.test(href) && !CONTACT_HINT.test(text)) return;
      try {
        const url = new URL(href, base);
        url.hash = "";
        if (url.host === base.host && url.protocol.startsWith("http")) {
          pages.add(url.toString());
        }
      } catch {
        // Relative junk like "javascript:void(0)". Skip it.
      }
    });
  }
  for (const path of ["/contact", "/contact-us", "/about", "/about-us"]) {
    try {
      pages.add(new URL(path, base).toString());
    } catch {
      // Malformed base; the homepage attempt already covered what we can do.
    }
  }
  pages.delete(base.toString());

  let tried = 0;
  for (const page of pages) {
    if (tried >= 3 || Date.now() > stopAt) break;
    tried += 1;

    const doc = await loadPage(page, 6000);
    if (!doc) continue;

    const best = pickBestEmail(emailsOn(doc), base.host);
    if (best) return { ...best, page };
  }

  return null;
}
