# Sponsor Pipeline — Be The Good UWO

Find sponsors, send outreach, track who says yes. Built for the Be The Good
exec team at Western.

---

## Setup, about 20 minutes

You need two free accounts: Supabase (the database) and Resend (sends the
email). Nothing here costs money at the volumes a student club sends.

### 1. Supabase

1. Go to [supabase.com](https://supabase.com), create a project. Free tier.
2. Open the **SQL Editor**, paste in everything from
   [supabase/schema.sql](supabase/schema.sql), hit run. That creates the
   tables, the realtime setup, and the five email templates. The file is
   idempotent — if you set the project up before and something looks off,
   paste it in again.
3. Go to **Project Settings → API** and copy three values:
   - Project URL
   - `publishable` key (or legacy `anon` key)
   - `secret` key (or legacy `service_role` key)

### 2. Resend

1. Go to [resend.com](https://resend.com), sign up, create an API key.
2. **Verify a domain** under Domains. This is the one step worth not skipping:
   without it you can only send to your own address, and mail from an
   unverified domain lands in spam.
   - If Be The Good has a domain, add it and paste in the DNS records.
   - No domain yet? You can test with `onboarding@resend.dev` as the from
     address, but it only delivers to the email you signed up with. Fine for
     checking the flow, not for a real send.

### 3. Environment

```bash
cp .env.example .env.local
```

Fill it in. The ones that matter:

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from step 1 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser-safe public key |
| `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` | server-only privileged key, **never commit** |
| `RESEND_API_KEY` | from step 2 |
| `RESEND_FROM` | `Be The Good UWO <sponsors@yourdomain.ca>` |
| `RESEND_REPLY_TO` | where replies should land |
| `TEAM_PASSWORD` | one shared password for the exec team |
| `SESSION_SECRET` | any long random string |

### 4. Run it

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Enter your name and the team
password. If a key is missing the app tells you which one instead of breaking.

---

## Getting the first emails out

1. **Add sponsors.** Top right, "Add sponsors". Three ways:
   - **Find leads** pulls businesses around London, Ontario automatically.
   - **Upload CSV** takes any spreadsheet with a name column.
   - **Add one** for a single sponsor you already know.
2. **Select who to contact.** Tick the checkboxes on the board or in the table.
3. **Send email.** The bar at the bottom appears. Pick a template, it is
   already matched to the category. Hit **Preview each one** to page through
   exactly what every sponsor receives, then send.
4. Everyone still marked New moves to **Contacted** automatically.
5. **Watch the cards.** "opened" and "clicked" chips appear as people engage.
6. **Drag** sponsors to Interested or Committed as they reply.
7. **Export** any slice to CSV with the filters applied.

---

## How the pieces work

### Lead discovery

Discovery runs **offline**, as a job, and fills a `lead_pool` table. "Add
sponsors" in the app is then just a filtered read of that table, which answers
instantly instead of spending five minutes on live API calls.

```bash
npm run leads:refresh                 # every source, then crawl for emails
npm run leads:refresh -- --dry-run    # report what each source has, write nothing
npm run leads:refresh -- --source=downtown_london
npm run leads:refresh -- --crawl-only # just hunt for emails on known websites
```

Run it about monthly. It takes roughly 20-40 minutes, mostly the email crawl.

Three sources, all open data or public directories:

| Source | Leads | Email | Phone | Website |
|---|---|---|---|---|
| Overture Maps | 7,894 | 50% | 94% | 85% |
| Downtown London BIA | 996 | 28% | 89% | 85% |
| London Chamber of Commerce | 945 | — | 95% | 85% |

**Overture Maps** is the bulk source: Meta, Microsoft, and Foursquare pooling
their business listings under permissive licences. It is bulk Parquet on S3
rather than an API, read with DuckDB — which is the main reason discovery
cannot live inside a web request.

**Downtown London BIA** and the **Chamber of Commerce** are curated member
directories. Smaller, but a BIA directory is independent local operators by
construction, and a Chamber member is a business that pays annual dues, which
is a decent proxy for having a marketing budget.

The Chamber publishes no member emails — contact goes through a form — so it
contributes names, phones, and websites, and the crawler does the rest.

#### Screening

Every lead is tagged `local` or `chain`, because a branch manager at TD or
Metro cannot approve a sponsorship. The signals are the source's own brand
field, a hand-kept list of chains common around London, and the same name
appearing at several addresses. "Independent businesses only" is on by default.

#### Finding emails

Most sources are thinner on emails than on websites, so the refresh job crawls
every pooled website that has no email yet: homepage first, then contact and
about pages it finds in the nav. It prefers `info@` over a personal inbox, and
prefers an address on the site's own domain — otherwise a footer credit like
`jade@somewebdesigner.ca` gets saved as the restaurant's contact. Roughly one
site in three yields an address.

Rows are stamped `website_checked_at` whether or not anything was found, so
repeat runs move on to new leads rather than retrying dead sites.

Expect to fill some gaps by hand or by phone. That is the nature of the data,
not a bug in the tool.

### Email tracking

Each send writes an `outreach_logs` row first, then bakes that row's id into:

- a **1x1 pixel** at `/api/track/open/[logId]` → marks opened
- **rewritten links** through `/api/track/click/[logId]` → marks clicked

A click also counts as an open, since Gmail and Outlook often block the pixel
but not the link. Treat open rates as a floor, not a precise number. That is
true of every email tool, not just this one.

The click redirect only ever forwards to an `http(s)` URL it can parse, so it
cannot be turned into an open redirect.

Optionally, point a **Resend webhook** at `/api/webhooks/resend` to also catch
bounces and spam complaints, which the pixel cannot see.

### Templates

Five ship with the schema: corporate sponsorship, small business partnership,
supply donation, nonprofit collaboration, and follow-up. Edit them under
**Templates** and the whole team sends the same wording.

Placeholders, filled per sponsor:

```
{{sponsor_name}} {{contact_name}} {{category}}
{{industry}} {{location}} {{sender_name}}
```

Missing fields fall back to something that still reads like a sentence, so a
sponsor with no contact name gets "Hi there," rather than "Hi ,".

You can also edit the subject and body in the composer for a one-off send
without changing the saved template.

### Team access

Everyone signs in with **one shared password plus their own name**. No accounts
to create, which is the point. Your name is stamped on every email sent and
every change made, and the whole team sees the same board updating live through
Supabase realtime.

Writes all go through this app's API routes using the service-role key. The
browser only ever holds the anon key, which is read-only under row level
security.

If you later want real per-person logins, `readTeamMember()` in
[src/lib/session.ts](src/lib/session.ts) is the only function to replace. Every
route already reads the actor through it, and the `team_access` table is
already in the schema.

---

## Deploying to Vercel

```bash
npm i -g vercel
vercel
```

Then add the same environment variables in the Vercel dashboard, or:

```bash
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

Set `NEXT_PUBLIC_APP_URL` to your real domain so tracking pixels and click
links point at the deployed app rather than localhost. On Vercel this is
detected automatically if you leave it blank.

Change `TEAM_PASSWORD` from whatever you used locally before you share the URL.

---

## Sending responsibly

This sends real email to real local businesses on behalf of Be The Good. A few
things worth holding to:

- **Send in small batches.** A hundred cold emails in one burst from a new
  domain is how a domain gets blacklisted. Start with 20 to 30.
- **Honour a no.** If someone asks not to be contacted, mark them Declined and
  leave them alone. Do not follow up.
- **Follow up once, not four times.** The follow-up template exists for one
  second touch.
- **Keep it accurate.** Do not promise sponsor benefits the team cannot
  deliver. BRAND.md §7 has the list that has actually been agreed on.

Canada's anti-spam law (CASL) covers this kind of outreach. Business-to-business
messages about a relevant offer are generally permitted, but every message needs
accurate sender identification and a working way to opt out. The footer carries
the org name and a real reply-to. Keep that inbox monitored.

---

## Project layout

```
src/
  app/
    page.tsx              gate, sign in or dashboard
    api/
      sponsors/           list, create, update, delete, bulk
      outreach/send/      the send engine, dry-run preview supported
      track/open|click/   tracking pixel and click redirect
      import/             CSV upload
      scrape/             pulls leads off lead_pool onto the board
      templates/          template CRUD
      export/             CSV export
      webhooks/resend/    bounce and complaint handling
  components/
    Dashboard.tsx         shell, filters, bulk action bar
    KanbanBoard.tsx       drag and drop columns
    SponsorTable.tsx      sortable table
    EmailComposer.tsx     template pick, edit, preview, send
    ImportPanel.tsx       lead pool / CSV / manual
    SponsorDrawer.tsx     detail edit and contact history
    usePipeline.ts        data and realtime
  lib/
    chains.ts             chain vs. independent screening
    leads/
      overture.ts         Overture Maps, via DuckDB
      downtown-london.ts  BIA directory
      london-chamber.ts   Chamber member directory
      emails.ts           finds a contact address on a business website
      store.ts            lead_pool reads and writes
    email.ts              personalization, tracked HTML
    session.ts            team gate
scripts/
  refresh-leads.mts       the offline discovery job
supabase/schema.sql       run this once
```

## Commands

```bash
npm run dev            # local
npm run build          # production build
npm run leads:refresh  # refill the lead pool (see Lead discovery)
npx eslint .           # lint
```
