-- Be The Good UWO — Sponsor Pipeline
-- Run this whole file once in the Supabase SQL editor.
-- Safe to re-run: everything is idempotent.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- sponsors
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sponsors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text,
  phone           text,
  website         text,
  category        text not null default 'small_business',
  industry        text,
  location        text default 'London, ON',
  status          text not null default 'new',
  potential_value numeric(12,2) default 0,
  contact_name    text,
  notes           text,
  source          text default 'manual',
  custom_fields   jsonb not null default '{}'::jsonb,
  last_contacted_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sponsors_status_check
    check (status in ('new','contacted','interested','committed','declined')),
  constraint sponsors_category_check
    check (category in ('corporate','small_business','nonprofit','supplier','alumni','other'))
);

-- One row per business email. Lets CSV import and the scraper upsert without
-- creating duplicates. Rows with a null email are never deduped, because
-- Postgres treats nulls as distinct in a unique constraint.
--
-- This has to be a plain unique constraint on the raw column. PostgREST's
-- upsert sends `on conflict (email)`, and Postgres only infers an arbiter
-- index whose definition matches exactly — an index on lower(email), or a
-- partial index with a where clause, matches nothing and every upsert dies
-- with "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Case folding happens in normalizeSponsorInput and the
-- scraper before a row ever reaches the database, so lower() here bought
-- nothing anyway.
drop index if exists public.sponsors_email_unique;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sponsors'::regclass
      and conname = 'sponsors_email_key'
  ) then
    alter table public.sponsors
      add constraint sponsors_email_key unique (email);
  end if;
end $$;

create index if not exists sponsors_status_idx   on public.sponsors (status);
create index if not exists sponsors_category_idx on public.sponsors (category);
create index if not exists sponsors_created_idx  on public.sponsors (created_at desc);

-- ─────────────────────────────────────────────────────────────
-- lead_pool — everything we have discovered, before anyone
-- decides to work it
--
-- Lead discovery used to happen inside the request that added
-- sponsors: hit an API, crawl websites, insert. That capped a run
-- at whatever fit in 300 seconds and re-did the same work daily.
--
-- Now discovery is a job that runs offline (npm run leads:refresh)
-- and fills this table, and "Add sponsors" is a query against it.
-- Rows here are candidates, not part of the pipeline; copying one
-- into sponsors is what puts it on the board, and imported_at
-- records that so nobody gets offered the same lead twice.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.lead_pool (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,
  -- Stable id from that source, so a refresh updates rather than duplicates.
  source_ref   text not null,
  name         text not null,
  -- Normalized name, for spotting the same business across two sources.
  name_key     text not null,
  email        text,
  phone        text,
  website      text,
  location     text,
  category     text not null default 'small_business',
  industry     text,
  -- Chain screening verdict. 'unknown' means nothing has classified it yet.
  scope        text not null default 'unknown',
  brand        text,
  locations    integer not null default 1,
  -- The source's own confidence in the record, where it publishes one.
  confidence   numeric,
  notes        text,
  -- When the email crawler last visited the website, so it is not redone.
  website_checked_at timestamptz,
  -- When we last opened this lead's own page on the source site to pick up
  -- details the listing pages omit. Only the Chamber needs this: its member
  -- websites live one click deeper, and a cron run can only get through part
  -- of the roster at a time, so each run has to know where to resume.
  detail_checked_at timestamptz,
  -- When this lead was copied onto the board. Null means still available.
  imported_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint lead_pool_scope_check check (scope in ('local','chain','unknown'))
);

create unique index if not exists lead_pool_source_ref_unique
  on public.lead_pool (source, source_ref);
create index if not exists lead_pool_name_key_idx on public.lead_pool (name_key);
create index if not exists lead_pool_available_idx
  on public.lead_pool (imported_at, scope, category);
create index if not exists lead_pool_uncrawled_idx
  on public.lead_pool (website_checked_at) where email is null and website is not null;
create index if not exists lead_pool_undetailed_idx
  on public.lead_pool (source, detail_checked_at) where website is null;

-- Added after the first release; harmless on a fresh install.
alter table public.lead_pool
  add column if not exists detail_checked_at timestamptz;

-- ─────────────────────────────────────────────────────────────
-- email_templates
-- ─────────────────────────────────────────────────────────────
create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  category    text not null default 'other',
  subject     text not null,
  body        text not null,
  description text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- outreach_logs
-- ─────────────────────────────────────────────────────────────
create table if not exists public.outreach_logs (
  id              uuid primary key default gen_random_uuid(),
  sponsor_id      uuid not null references public.sponsors(id) on delete cascade,
  outreach_type   text not null default 'email',
  template_used   text,
  template_id     uuid references public.email_templates(id) on delete set null,
  subject         text,
  body            text,
  to_email        text,
  sent_by         text,
  provider_id     text,
  sent_at         timestamptz not null default now(),
  opened          boolean not null default false,
  opened_at       timestamptz,
  open_count      integer not null default 0,
  clicked         boolean not null default false,
  clicked_at      timestamptz,
  click_count     integer not null default 0,
  response_status text not null default 'pending',
  error           text,
  constraint outreach_response_check
    check (response_status in ('pending','no_response','replied','bounced','failed','unsubscribed'))
);

create index if not exists outreach_sponsor_idx on public.outreach_logs (sponsor_id, sent_at desc);
create index if not exists outreach_sent_idx    on public.outreach_logs (sent_at desc);
create index if not exists outreach_provider_idx on public.outreach_logs (provider_id);

-- ─────────────────────────────────────────────────────────────
-- activity_log — every action any team member takes
-- ─────────────────────────────────────────────────────────────
create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null default 'unknown',
  action     text not null,
  sponsor_id uuid references public.sponsors(id) on delete cascade,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_created_idx on public.activity_log (created_at desc);
create index if not exists activity_sponsor_idx on public.activity_log (sponsor_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- team_access — per-sponsor access levels (schema kept for future
-- per-user restrictions; today everyone on the team has full access)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.team_access (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  sponsor_id   uuid references public.sponsors(id) on delete cascade,
  access_level text not null default 'edit',
  created_at   timestamptz not null default now(),
  constraint team_access_level_check check (access_level in ('view','edit','admin')),
  unique (user_id, sponsor_id)
);

-- ─────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists sponsors_touch on public.sponsors;
create trigger sponsors_touch before update on public.sponsors
  for each row execute function public.touch_updated_at();

drop trigger if exists templates_touch on public.email_templates;
create trigger templates_touch before update on public.email_templates
  for each row execute function public.touch_updated_at();

drop trigger if exists lead_pool_touch on public.lead_pool;
create trigger lead_pool_touch before update on public.lead_pool
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Realtime — the dashboard subscribes to these
-- ─────────────────────────────────────────────────────────────
alter table public.sponsors      replica identity full;
alter table public.outreach_logs replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.sponsors;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.outreach_logs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.activity_log;
  exception when duplicate_object then null;
  end;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Writes only ever happen server-side through the service-role key
-- (which bypasses RLS), behind the app's team password gate.
-- The browser uses the anon key for read + realtime only.
-- ─────────────────────────────────────────────────────────────
alter table public.sponsors       enable row level security;
alter table public.outreach_logs  enable row level security;
alter table public.email_templates enable row level security;
alter table public.activity_log   enable row level security;
alter table public.team_access    enable row level security;
-- No anon read policy for lead_pool: raw discovery output is only ever
-- touched server-side by the refresh job and the import route.
alter table public.lead_pool      enable row level security;

drop policy if exists "anon read sponsors" on public.sponsors;
create policy "anon read sponsors" on public.sponsors for select using (true);

drop policy if exists "anon read outreach" on public.outreach_logs;
create policy "anon read outreach" on public.outreach_logs for select using (true);

drop policy if exists "anon read templates" on public.email_templates;
create policy "anon read templates" on public.email_templates for select using (true);

drop policy if exists "anon read activity" on public.activity_log;
create policy "anon read activity" on public.activity_log for select using (true);

-- ─────────────────────────────────────────────────────────────
-- Seed: the five outreach templates
-- Placeholders: {{sponsor_name}} {{contact_name}} {{category}}
--               {{industry}} {{location}} {{sender_name}}
-- ─────────────────────────────────────────────────────────────
insert into public.email_templates (slug, name, category, subject, body, description, is_default)
values
(
  'corporate-sponsorship',
  'Corporate sponsorship',
  'corporate',
  'Partnership with Be The Good UWO, a Western student nonprofit',
  E'Hi {{contact_name}},\n\nI am {{sender_name}} with Be The Good, a student led nonprofit at Western University. We run three things: Be The Good Care (an app for caregiver burnout), care packages with food and hygiene kits for people facing hardship in London, and mentorship for incoming students.\n\nWe are looking for a few partners for this year, and {{sponsor_name}} stood out. Sponsors get their logo on our site and event materials, shoutouts to our campus audience on Instagram, a volunteer day for your team, and impact updates showing exactly where the money went.\n\nWould you be open to a 15 minute call to talk about what a partnership could look like?\n\nThanks for reading,\n{{sender_name}}\nBe The Good UWO\n@bethegooduwo',
  'Larger companies and corporate CSR contacts.',
  true
),
(
  'small-business-partnership',
  'Small business partnership',
  'small_business',
  'A local partnership idea for {{sponsor_name}}',
  E'Hi {{contact_name}},\n\nI am {{sender_name}} from Be The Good, a student run nonprofit at Western. We build care packages for people facing hardship in London and run mentorship for incoming students.\n\nWe would love to team up with {{sponsor_name}}. Local partners usually help in one of two ways: a small sponsorship that funds a batch of care packages, or in kind support like product or a gift card for a campus event. Either way you get your name on our materials and in front of a few thousand Western students.\n\nHappy to stop by in person if that is easier. Would that work?\n\nThank you,\n{{sender_name}}\nBe The Good UWO\n@bethegooduwo',
  'Independent shops, cafes, and services around London.',
  true
),
(
  'supply-donation',
  'Supply or in kind donation',
  'supplier',
  'Donating supplies for care packages in London',
  E'Hi {{contact_name}},\n\nI am {{sender_name}} with Be The Good, a student led nonprofit at Western University. We pack care packages with food, hygiene items, and everyday essentials for people facing hardship across London, then get them into the right hands.\n\nWe are reaching out to {{sponsor_name}} about an in kind donation. Things we always need: non perishable food, toiletries, socks, hand warmers, reusable bags. Overstock or short dated stock works great for us.\n\nWe can pick up, and we will credit {{sponsor_name}} on our site and socials. Is there someone there who handles donation requests?\n\nThanks so much,\n{{sender_name}}\nBe The Good UWO\n@bethegooduwo',
  'Grocers, pharmacies, wholesalers, and anyone with product to give.',
  true
),
(
  'nonprofit-collaboration',
  'Nonprofit collaboration',
  'nonprofit',
  'Be The Good UWO x {{sponsor_name}}',
  E'Hi {{contact_name}},\n\nI am {{sender_name}} from Be The Good, a student led nonprofit at Western University. We pack care packages for people facing hardship in London, run peer mentorship for incoming students, and are organizing regular food bank volunteer shifts this year.\n\nI wanted to reach out to {{sponsor_name}} because our work overlaps. We can bring student volunteers, campus reach, and hands on help. We would love to find out where a collaboration would actually be useful to you.\n\nWould you have 15 minutes in the next couple weeks to talk?\n\nAppreciate your time,\n{{sender_name}}\nBe The Good UWO\n@bethegooduwo',
  'Peer nonprofits, food banks, shelters, and community orgs.',
  true
),
(
  'follow-up',
  'Follow up',
  'follow_up',
  'Following up: Be The Good UWO',
  E'Hi {{contact_name}},\n\nJust floating this back to the top of your inbox. I reached out about a partnership between {{sponsor_name}} and Be The Good, the student led nonprofit at Western.\n\nNo pressure at all if the timing is wrong. If it helps, I can send a one page breakdown of where sponsor money goes and what partners get back.\n\nWould a quick call be easier?\n\nThanks,\n{{sender_name}}\nBe The Good UWO\n@bethegooduwo',
  'Second touch for anyone who has not replied.',
  true
)
on conflict (slug) do nothing;
