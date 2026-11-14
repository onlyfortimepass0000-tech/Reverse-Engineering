# BUILD LISTKIT: the full blueprint

Date: 14 Nov 2026. Companion to `Reverse engineering ListKit and Instantly/` (the research this is built on).

**How to read the tags**
- `[VERIFIED]` seen in ListKit, Instantly or SmartLead public docs on 13 Nov 2026 (evidence is in the research file).
- `[DESIGN]` our own decision. Change it if you want.
- `[ESTIMATE]` a rough number. Check before you spend money on it.
- `[UNVERIFIED]` a third-party fact I did not check. Check before you rely on it.

---

## 0. TL;DR

**What we are building:** a cold-email platform sold as one bundle: lead data + domains + inboxes + warmup + AI copy + sending + inbox + API/MCP. ListKit's model.

**The honest scope.** ListKit is three layers. We can build one fully, rent one, and must buy or earn the third.

| Layer | What it is | Can we build it? | Plan |
|---|---|---|---|
| Software | App, API, MCP, credits, orders, campaigns, inbox, billing | **Yes, fully** | Build it (this file, sections 3 to 9 and 12 to 17) |
| Infrastructure | Domains, mailboxes, warmup, sending, reputation | **Rent first, build later** | Vendor APIs first (SmartLead + a mailbox reseller), own engine in Phase 5 |
| Data | Hundreds of millions of contacts, verified | **No, not at ListKit's scale** | License it, pass it through, or build a niche one (section 6) |

**Recommended path in five lines**
1. Phase 0: sell outbound as an agency first (Instantly or SmartLead, $47 to $94/mo). Proves demand before any code.
2. Phases 1 to 4: build the software wrapper the way ListKit did: our app, credits and orders on top of a licensed data source and SmartLead as the sending engine.
3. Hide the engine behind a `SendingEngine` interface so it can be swapped.
4. Phase 5: replace SmartLead with our own sequencer once volume justifies it.
5. Phase 6: own warmup pool and own data, only after revenue.

**Timeline** `[ESTIMATE]`, building with Claude Code in focused sessions:

| Phase | Result | Effort |
|---|---|---|
| 0 | Agency offer live, 2 to 3 paying pilots | 1 to 2 weeks, no code |
| 1 | Search, credits, orders, billing, CSV export | 1 to 2 weeks |
| 2 | Campaigns and inbox on SmartLead | 2 weeks |
| 3 | Domains and mailboxes provisioned by vendor | 1 to 2 weeks |
| 4 | Public API, webhooks, MCP server | 1 week |
| 5 | Own sending engine | 4 to 6 weeks |
| 6 | Own warmup pool, own data | Months |

**Using this file with Claude Code:** open a session in the project repo, paste "Read BUILD LISTKIT blueprint.md. Build Phase N exactly as written. Show the plan first." Section 20 has a ready prompt for every phase.

---

## 1. The spec: what ListKit actually does `[VERIFIED]`

Everything we copy, in one list. Each line maps to a module in this blueprint.

| ListKit feature | Detail | Our module |
|---|---|---|
| Lead search | Filters: job title, seniority, department, company size, revenue, technology, location, intent topics, funding, hiring, industry, keywords, AI score. Plus plain-English AI search | Section 7 |
| Orders | Estimate, reserve credits, fulfil, verify at export, partial/shortfall, 25,000 cap, one order at a time | Section 9 |
| Credits | 1 per verified email, 3 per US mobile, 0.1 per outside-list verify, 100 per AI script. Expire after 60 days. Top-up 2,000 for $47 | Section 8 |
| Bundle | $597/mo: 20 domains, 40 Google inboxes, ~1,000 emails/day, 10,000 credits, 20,000 stored contacts. Stackable up to 50 | Sections 8, 19 |
| Domains and inboxes | Pre-warmed (.info, shared pool, minutes) or branded (.com, 72h setup + 14 days warmup) | Sections 10, 11 |
| Ramp | 1, 5, 9, 13, 17, 21, 25 emails/day over 7 sending days | Section 11 |
| Campaigns | Sequence, schedule, senders, AI writer, AI spintax, analytics | Section 12 |
| Inbox | Threads, reply, forward, lead categories | Section 13 |
| AI | Script Writer (100 credits), spintax (free) | Section 14 |
| API | REST `/v1`, `lk_live_` keys, up to 25 per account, token-bucket limits by class | Section 15 |
| MCP | Remote server at `/mcp`. Payments and mailbox passwords kept out | Section 15 |
| Webhooks | Own relay, `order.completed` etc. | Section 15 |
| Exclusions | Skip already-bought, exclude list, per-company cap | Section 9 |
| App | SPA with login, onboarding call, community | Section 16 |

---

## 2. Build, rent or buy: every component

| Component | Phase 1 to 4 (rent) | Later (own) | Why |
|---|---|---|---|
| Web app, API, MCP | **Build** | Build | This is the product |
| Credits, billing, orders | **Build** | Build | Pure software, our margin lives here |
| Auth, teams | Supabase Auth | Same | Not a differentiator |
| Payments | Stripe | Same | Subscriptions + top-ups |
| Lead data | Licensed API or niche data (section 6) | Own database | Biggest cost and legal risk |
| Email finding | LeadMagic, TryKitt `[VERIFIED named by ListKit]` | Own waterfall | Vendors do this well |
| Email verification | MillionVerifier, AtData, LeadMagic, TryKitt `[VERIFIED named by ListKit]` | Own checks for syntax and MX only | Real SMTP probing needs clean IPs and port 25 |
| Domains | Registrar API | Same | Commodity |
| DNS | Cloudflare API | Same | Free, scriptable |
| Mailboxes | Reseller (Zapmail or similar) `[UNVERIFIED API terms]` | Google Workspace reseller + Microsoft 365 | Mailbox provisioning is where margin is |
| Warmup | Vendor's warmup (SmartLead includes it) | Own peer pool | Needs hundreds of real inboxes to look natural |
| Sending engine | **SmartLead API** (what ListKit does) | Own sequencer | Fastest path to a working product |
| Reply classification | Claude Haiku 5.5 | Same | Cheap and accurate |
| Copy generation | Claude Sonnet 5.5 | Same | |
| Email transport for our own app mail | Resend | Same | Already used in ATOMZ products |

**Reseller check before building on SmartLead** `[VERIFIED + open question]`: SmartLead itself has client workspaces ($29/mo each on Pro and Smart), client logins, white-label branding and per-client API keys. That is a first-party reseller path, so prefer it over scraping a plain account. Whether ListKit uses it is unknown. Read SmartLead's terms for reselling before launch. Instantly's API v2 is the alternative engine; its reseller terms were not checked.

---

## 3. Architecture

```
                        +-------------------------------+
   Browser / API / MCP  |        EDGE / APP LAYER       |
   -------------------> |  Next.js app + REST /v1 + MCP |
                        |  Supabase Auth, rate limiter  |
                        +---------------+---------------+
                                        |
            +---------------------------+-----------------------------+
            |                           |                             |
   +--------v--------+        +---------v---------+         +---------v---------+
   |  ORDER SERVICE  |        |  CAMPAIGN SERVICE |         |  INFRA SERVICE    |
   |  search, credits|        |  sequences, leads |         |  domains, DNS,    |
   |  fulfil, verify |        |  inbox, AI copy   |         |  mailboxes, health|
   +--------+--------+        +---------+---------+         +---------+---------+
            |                           |                             |
   +--------v--------+        +---------v---------+         +---------v---------+
   | DATA ADAPTERS   |        | SendingEngine     |         | Registrar, DNS,   |
   | vendor A/B/own  |        | interface         |         | mailbox vendor    |
   | verifier chain  |        |  - SmartLead (P2) |         | adapters          |
   +-----------------+        |  - Own (P5)       |         +-------------------+
                              +-------------------+
                                        |
                 +----------------------v----------------------+
                 |  Postgres (Supabase): one database, RLS     |
                 |  Job queue: Postgres + pg_cron / worker     |
                 +---------------------------------------------+
```

### 3.1 Stack `[DESIGN]`
| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere | Claude Code is strongest here, one language end to end |
| App and API | Next.js 15 (App Router) on Vercel | Fast to ship, preview deploys |
| Database | Supabase Postgres with row-level security | One store, RLS gives multi-tenancy for free |
| Auth | Supabase Auth (email + Google) | ListKit uses Clerk; Supabase has fewer vendors |
| Jobs | One always-on Node worker (Fly.io or Railway) reading a Postgres job table with `FOR UPDATE SKIP LOCKED` | Orders and sending outlive a serverless timeout |
| Scheduler | `pg_cron` ticks that enqueue jobs | ATOMZ Payment Reminders already works this way |
| Payments | Stripe Billing + Checkout | Subscriptions, top-ups, invoices |
| Search (phase 1) | Postgres indexes | Fine up to a few million rows |
| Search (scale) | Typesense or OpenSearch, later ClickHouse for counts | Only when Postgres counts get slow |
| Files | Supabase Storage (CSV exports) | |
| Email (app mail) | Resend | |
| Observability | Sentry + log drain + a `/admin` console | |

Alternative if you prefer your ATOMZ stack: Cloudflare Workers + D1/Queues + cron triggers. ListKit itself moved its fulfilment engine to Cloudflare ("v4") `[VERIFIED]`. I recommend Supabase + a worker for Phase 1 to 4 because Postgres transactions make the credit ledger simpler and safer.

### 3.2 Environments
- `dev` (local), `staging` (Vercel preview + Supabase branch), `prod`.
- Never test sending from production mailboxes. Staging uses a sandbox adapter that records sends instead of delivering them.

---

## 4. Data model (Postgres)

Every tenant table carries `org_id` and an RLS policy `org_id in (select org_id from memberships where user_id = auth.uid())`. The worker uses the service role.

```sql
-- ---------- tenancy ----------
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_customer_id text,
  plan text not null default 'none',          -- none | bundle
  bundle_count int not null default 0,        -- stackable, max 50
  status text not null default 'active',      -- active | paused | suspended
  created_at timestamptz not null default now()
);
create table memberships (
  org_id uuid references orgs(id) on delete cascade,
  user_id uuid not null,                      -- auth.users.id
  role text not null check (role in ('owner','admin','member')),
  primary key (org_id, user_id)
);
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null,
  prefix text not null,                       -- shown in UI, e.g. lk_live_ab12
  key_hash text not null,                     -- sha256 of full key, never store the key
  scopes text[] not null default '{all}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
-- cap: 25 active keys per org (enforce in app and with a trigger)

-- ---------- credits ----------
create table credit_grants (                  -- buckets that expire (60 days)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  source text not null check (source in ('plan','topup','promo','refund','adjustment')),
  amount numeric(14,2) not null,
  remaining numeric(14,2) not null check (remaining >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table credit_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  order_id uuid,
  amount numeric(14,2) not null,
  status text not null check (status in ('held','settled','released')),
  created_at timestamptz not null default now()
);
create table credit_ledger (                  -- append only, the audit trail
  id bigserial primary key,
  org_id uuid not null references orgs(id),
  kind text not null check (kind in ('grant','hold','settle','release','expire','refund')),
  amount numeric(14,2) not null,              -- positive adds, negative removes
  grant_id uuid, hold_id uuid, order_id uuid,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

-- ---------- lead data (global, not per tenant) ----------
create table companies (
  id uuid primary key default gen_random_uuid(),
  domain text unique,
  name text, industry text, sic text, employee_count int, revenue_usd bigint,
  country text, region text, city text,
  technologies text[], funding_stage text, hiring boolean,
  attrs jsonb not null default '{}',
  source text not null, source_id text, updated_at timestamptz default now()
);
create table people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  full_name text, first_name text, last_name text,
  title text, seniority text, department text,
  country text, region text, city text,
  linkedin_url text,
  source text not null, source_id text, updated_at timestamptz default now()
);
create table person_emails (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id),
  email citext not null,
  kind text not null default 'work',          -- work | personal | generic
  status text not null default 'unknown',     -- good | risky | bad | unknown
  verified_at timestamptz, verifier text,
  unique (person_id, email)
);
create table person_phones (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id),
  e164 text not null, kind text,              -- mobile | direct | hq
  country text, verified_at timestamptz,
  unique (person_id, e164)
);
create table suppression (                    -- global do-not-send
  email citext primary key,
  reason text not null,                       -- unsubscribe | bounce | complaint | request | legal
  created_at timestamptz not null default now()
);

-- ---------- orders ----------
create table searches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  filters jsonb not null, ai_prompt text,
  pool_count bigint, created_at timestamptz default now()
);
create table orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  search_id uuid references searches(id),
  filters jsonb not null,
  quantity int not null check (quantity between 1 and 25000),
  include_phones boolean not null default false,
  max_per_company int,
  status text not null check (status in
    ('queued','processing','completed','partial','stopped','failed')),
  engine text not null default 'v1',
  estimated_pool bigint, expected_delivered bigint,
  delivered int not null default 0, shortfall int not null default 0,
  credits_held numeric(14,2) not null default 0,
  credits_charged numeric(14,2) not null default 0,
  dropped_by_reason jsonb not null default '{}',
  idempotency_key text, error text,
  created_at timestamptz default now(), finished_at timestamptz,
  unique (org_id, idempotency_key)
);
create table order_items (
  order_id uuid references orders(id) on delete cascade,
  person_id uuid references people(id),
  email citext, email_status text, phone text,
  charged numeric(8,2) not null default 0,
  primary key (order_id, person_id)
);
create table purchased_people (               -- "skip already bought"
  org_id uuid references orgs(id),
  person_id uuid references people(id),
  first_order_id uuid,
  primary key (org_id, person_id)
);
create table exclusions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  kind text not null check (kind in ('email','domain','company')),
  value text not null, unique (org_id, kind, value)
);

-- ---------- infrastructure ----------
create table sending_domains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),            -- null while in the pre-warmed pool
  domain text unique not null,
  tld text, kind text check (kind in ('prewarmed','branded')),
  registrar text, registrar_ref text,
  dns_status text default 'pending',          -- pending | ok | broken
  spf_ok bool, dkim_ok bool, dmarc_ok bool,
  forward_to text,                            -- sending domains redirect to the real site
  blacklist_status text default 'clean',
  status text default 'provisioning',         -- provisioning | warming | ready | paused | retired
  created_at timestamptz default now()
);
create table mailboxes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  domain_id uuid not null references sending_domains(id),
  email citext unique not null,
  provider text not null,                     -- google | microsoft | vendor_x
  provider_ref text,
  credentials_enc bytea,                      -- encrypted, never returned by API or MCP
  daily_limit int not null default 25,
  warmup_day int not null default 0,
  status text not null default 'provisioning',-- provisioning | warming | ready | paused | error | retired
  health_score numeric(5,2),
  engine_account_id text,                     -- SmartLead email account id
  created_at timestamptz default now()
);
create table mailbox_daily_stats (
  mailbox_id uuid references mailboxes(id), day date,
  sent int, bounced int, replied int, spam_flagged int, warmup_sent int,
  primary key (mailbox_id, day)
);

-- ---------- campaigns ----------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null,
  status text not null default 'draft',       -- draft | scheduled | active | paused | completed | error
  engine text not null default 'smartlead',   -- smartlead | own
  engine_campaign_id text,                    -- smartlead_campaign_id
  timezone text not null default 'UTC',
  schedule jsonb not null,                    -- [{days:[1..5], from:'09:00', to:'17:00'}]
  settings jsonb not null default '{}',       -- see 12.3
  created_at timestamptz default now()
);
create table campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  step_no int not null, delay_days int not null default 0,
  unique (campaign_id, step_no)
);
create table step_variants (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references campaign_steps(id) on delete cascade,
  subject text, body text not null, disabled boolean default false
);
create table campaign_mailboxes (
  campaign_id uuid references campaigns(id) on delete cascade,
  mailbox_id uuid references mailboxes(id),
  primary key (campaign_id, mailbox_id)
);
create table campaign_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  org_id uuid not null,
  email citext not null, first_name text, last_name text, company text,
  vars jsonb not null default '{}',           -- extra merge fields
  status text not null default 'active',      -- active | replied | bounced | unsubscribed | completed | paused
  category text,                              -- interested | not_interested | neutral | ooo | wrong_person | meeting
  current_step int not null default 0,
  next_send_at timestamptz,
  unique (campaign_id, email)
);
create index on campaign_leads (next_send_at) where status = 'active';

create table messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_lead_id uuid references campaign_leads(id),
  mailbox_id uuid references mailboxes(id),
  direction text not null check (direction in ('out','in')),
  step_no int, variant_id uuid,
  message_id text, in_reply_to text, thread_key text,
  subject text, body text,
  sent_at timestamptz, opened_at timestamptz, clicked_at timestamptz,
  bounce_type text,                           -- hard | soft
  unique (campaign_lead_id, step_no, direction)   -- idempotent sends
);
create table events (                         -- feeds webhooks + analytics
  id bigserial primary key,
  org_id uuid not null, type text not null, payload jsonb not null,
  created_at timestamptz default now()
);

-- ---------- webhooks ----------
create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, url text not null, secret text not null,
  events text[] not null, active boolean default true
);
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid references webhook_endpoints(id), event_id bigint,
  attempt int default 0, status_code int, next_attempt_at timestamptz, delivered_at timestamptz
);

-- ---------- jobs ----------
create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null, payload jsonb not null,
  run_at timestamptz not null default now(),
  locked_at timestamptz, attempts int default 0, last_error text,
  status text not null default 'queued'       -- queued | running | done | failed
);
create index on jobs (run_at) where status = 'queued';
```

Notes
- Global tables (`companies`, `people`, `person_emails`, `suppression`) have no tenant RLS. Tenants only reach them through order results, never directly.
- Store purchased contacts per org (`order_items`, `purchased_people`) so the "20,000 stored contacts" limit `[VERIFIED]` can be enforced by counting rows.

---

## 5. Auth, teams and API keys

- Sign-up: email + Google (Supabase Auth). First user becomes `owner` of a new org.
- Roles `[DESIGN]`: owner (billing, delete), admin (everything else), member (campaigns, inbox, search; no billing, no keys).
- API keys: ListKit's look is `lk_live_...` `[VERIFIED]`; ours uses our own prefix, for example `ak_live_<32 random bytes, base32>`. Show the full key once. Store `sha256(key)` and the prefix. Up to 25 active keys per org `[VERIFIED for ListKit]`. Scopes: `read`, `write`, `search`, `spend`, `all`.
- Key check on every request: hash, look up, check `revoked_at`, check org status, then rate limit.
- Never log full keys or put them in URLs.

---

## 6. The lead data layer (the hard part)

### 6.1 What ListKit does `[VERIFIED]`
A large licensed database ("obtained from its data providers"), plus enrichment providers on top, plus finders and verifiers at order time. No provider is named. Claimed size varies from 626M to 977M contacts depending on the page.

### 6.2 Four ways to get data for us `[DESIGN]`

| Option | What it means | Pros | Cons |
|---|---|---|---|
| **A. Resale-licensed B2B data** | Contract with a vendor whose terms allow reselling or embedding (OEM or API partner) | Scales, legal, one integration | Costs real money upfront, vendor lock-in. Standard terms of consumer-grade vendors usually **forbid resale** `[UNVERIFIED: read Apollo, Lusha and Vibe Prospecting terms]` |
| **B. Bring your own key (pass-through)** | The customer connects their own Apollo, Lusha or similar account; we search and enrich on their behalf | No resale, zero data cost for us | Customer needs a second subscription, weaker "all in one" story |
| **C. Niche database we build** | Public sources for one vertical and region, for example Indian local businesses: Google Maps listings, company websites, public registries | Cheap, fresh, defensible, matches ATOMZ clients (gyms, clinics, coaching, restaurants) | Small, needs email finding and verification, scraping terms need care |
| **D. Hybrid (recommended)** | Start with C plus B. Add A when revenue pays for it | Launch fast, no resale risk | Smaller search universe at first |

Tools already in your Claude account that fit these options: Apollo, Lusha, Vibe Prospecting (search and enrich), the `google-maps-scraper` and `gmaps-leads-to-gsheet` skills (option C), Supabase and Vercel (hosting).

### 6.3 Never do this
- Scraping LinkedIn or any site whose terms forbid it, then selling the data.
- Buying "lakh emails" CSV dumps. Quality is poor, they are full of spam traps and the provenance is illegal in most regimes.
- Reselling API results from a vendor whose terms forbid it.

### 6.4 Pipeline (for options C and D)

```
SOURCE -> RAW -> NORMALISE -> ENTITY MATCH -> ENRICH -> STORE -> INDEX
```
1. **Source adapters** return raw records. One adapter per source: Google Places / Maps listing, website crawl, registry file, vendor API.
2. **Raw store** keeps the original payload with `source`, `source_id`, `fetched_at` (provenance, needed for deletion requests).
3. **Normalise:** trim, lowercase emails and domains, E.164 phones, map titles to `seniority` and `department` with a lookup table plus an LLM fallback, map industries to one taxonomy.
4. **Entity match:** company by `domain` (primary) then `name + city`. Person by `(company_id, normalised name)`. Merge duplicates, keep the freshest field per source ranking.
5. **Enrich:** find missing emails with a waterfall (pattern guess from the domain plus finder vendors), find technologies from the site, find funding and hiring from public pages. Mark every field with its source.
6. **Store** in `companies`, `people`, `person_emails`, `person_phones`.
7. **Index** into search (Postgres first).

### 6.5 Email finding waterfall `[DESIGN]`
```
1. Known verified email in our DB            -> use
2. Pattern guess (first.last@, flast@, ...)  -> verify cheapest first
3. Finder vendor A (e.g. LeadMagic)          -> verify result
4. Finder vendor B (e.g. TryKitt)            -> verify result
5. Give up                                   -> not delivered, not charged
```
Stop at the first result that verifies `good`. Cost per contact is the sum of vendor calls actually made, so order vendors by price and hit rate.

### 6.6 Verification chain (the "triple-verified" claim) `[DESIGN]`
ListKit does not define "triple" publicly. Our definition, three independent checks at export time:
1. **Local checks (free):** syntax, disposable-domain list, role-account list (`info@`, `sales@`), MX record exists, domain is not parked.
2. **Vendor A** (for example MillionVerifier): deliverable / catch-all / invalid.
3. **Vendor B** (for example AtData or LeadMagic) only for results that are `unknown` or catch-all.

Output classes `[VERIFIED]`: `good`, `risky` (mostly catch-all), `bad`. Billing rule `[DESIGN]`: charge for `good` only by default. `risky` is opt-in (`allow_risky: true`) and charged. `bad` is dropped and never charged.

Why we do not run our own SMTP probing: it needs outbound port 25, which most cloud hosts block or throttle, plus clean IP reputation and greylisting handling. Buy it.

### 6.6b Phones
Optional. 3 credits for a US mobile `[VERIFIED]`. Source from a vendor only. Respect do-not-call rules for any calling use; this blueprint covers email.

### 6.7 Freshness
- Re-verify an email if older than 30 days at export `[DESIGN]`. This is why verification happens at export, not at ingest `[VERIFIED for ListKit]`.
- Re-crawl company pages quarterly.
- Hard bounces from any customer campaign flow back: mark `person_emails.status = 'bad'` and add to `suppression`. This feedback loop makes the data better over time and is a real moat.

### 6.8 Cost model `[ESTIMATE]`
Per delivered contact: finder calls + verifier calls + storage. Target data COGS at or below half a cent to one cent per delivered contact, against a retail credit price of about 2.35 cents (ListKit top-up: $47 for 2,000 credits `[VERIFIED]`). Measure it from day one with a `vendor_cost_usd` column on every vendor call.

---

## 7. Search and estimate

### 7.1 Filters (match ListKit) `[VERIFIED]`
Job title (plus AI expansion of synonyms), seniority, department, company size, revenue, technology, location (company vs person), intent topics, funding, hiring, industry / vertical / micro-industry / SIC, keywords, business model, growth stage, AI company score. Plus plain-English search.

### 7.2 Query design
- A filter object becomes a SQL `WHERE` over a denormalised view `search_people_v` (person + company fields). Index the common columns (`seniority`, `department`, `country`, `employee_count`, GIN on `technologies`).
- **Counts:** use `EXPLAIN` estimates or a materialised count table for fast "pool size"; exact counts only when the user clicks Estimate.
- **Job-title expansion:** lookup table first (`ceo` expands to `chief executive officer, founder, co-founder, managing director`), LLM only on a miss, cached.
- **Plain-English search:** Claude turns the sentence into the same filter JSON. Show the parsed filters to the user and let them edit. Never run an unparsed prompt against the DB.

### 7.3 Estimate `[VERIFIED shape]`
`POST /v1/orders/estimate` returns:
- `estimated_pool`: matches before verification
- `expected_delivered`: after verification, using the historical pass rate for this filter family
- `credits_needed`, `breakdown` (emails, phones), `warnings` (cap, thin pool)

Keep a table of historical pass rates per source and title seniority so `expected_delivered` is honest, not optimistic.

### 7.4 Search is free
Searching and previews must cost nothing and reveal no emails. Preview rows show name, title, company, location, and a masked email (`j***@acme.com`). Revealing is what an order does.

---

## 8. Credits and billing

### 8.1 Rules `[VERIFIED for ListKit, copied]`
| Action | Credits |
|---|---|
| Verified business email delivered | 1 |
| US mobile found | 3 |
| Email verified from an outside list | 0.1 |
| AI Script Writer run | 100 |
| AI spintax | 0 |
| Sending | 0 |

Credits expire 60 days after grant. Bundle gives 10,000/month. Top-up 2,000 for $47.

### 8.2 Ledger algorithm (the part that must never be wrong)
All in one Postgres transaction with row locks.

**Hold** (when an order is placed):
```
BEGIN;
  -- lock the org's live grants, oldest expiry first
  SELECT * FROM credit_grants
   WHERE org_id = $1 AND remaining > 0 AND expires_at > now()
   ORDER BY expires_at ASC FOR UPDATE;
  total = SUM(remaining)
  IF total < needed THEN ROLLBACK -> error insufficient_credits
  -- walk grants, subtract until needed is covered; write one ledger row per grant touched
  INSERT credit_holds (status='held', amount=needed)
  INSERT credit_ledger (kind='hold', amount=-needed, idempotency_key)
COMMIT;
```
**Settle** (after fulfilment): charge only what was delivered. Write `settle` rows for the charged amount and a `release` row returning the unused part to the same grants (grants keep their original `expires_at`).

**Expire:** a daily job zeroes `remaining` on grants past `expires_at` and writes `expire` ledger rows.

**Idempotency:** every ledger write carries an `idempotency_key` (`order:<id>:hold`, `order:<id>:settle`). A retry cannot double-charge.

**Invariant to test:** for each org, `sum(credit_grants.remaining) + sum(active holds) = sum(grants.amount) - sum(settled) - sum(expired)`.

### 8.3 Stripe
| Event | Action |
|---|---|
| `checkout.session.completed` (bundle) | Set `plan`, `bundle_count`, grant 10,000 credits per bundle, start provisioning |
| `invoice.paid` (monthly) | Grant the month's credits with 60-day expiry |
| `checkout.session.completed` (top-up) | Grant 2,000 credits |
| `customer.subscription.updated` | Change bundle count, change quotas |
| `invoice.payment_failed` | Dunning, then pause sending after grace (section 17) |
| `customer.subscription.deleted` | Pause campaigns, retire mailboxes on the retire schedule |

Verify every webhook signature. Store Stripe event ids to ignore replays. `[DESIGN]` Do not offer a free trial: no free trial is ListKit's policy `[VERIFIED]` and it is also the cheapest abuse filter for a cold-email product.

---

## 9. The order pipeline

### 9.1 State machine `[VERIFIED statuses]`
```
queued -> processing -> completed
                     -> partial     (delivered < quantity, shortfall recorded, remainder refunded)
                     -> stopped     (user stop, delivered so far kept and charged)
                     -> failed      (system error, everything refunded)
```
Rules: one order `processing` per org at a time, others `queued` `[VERIFIED]`. Maximum 25,000 contacts per order `[VERIFIED]`. `POST /orders` is idempotent on `Idempotency-Key` `[VERIFIED]`.

### 9.2 Worker algorithm
```
function runOrder(orderId):
  order = lock(orderId); set status = processing
  needed = order.quantity
  hold credits for needed (1 per email + 3 per phone if requested)

  excluded = load(exclusions[org]) + purchased_people[org] + suppression
  per_company = counter map

  while delivered < needed and candidate pool not exhausted:
      batch = fetch next N candidates (ordered by match quality, random within tie)
      for c in batch:
          if c.person_id in purchased_people  -> dropped_by_reason.already_bought++ ; continue
          if c matches exclusions/suppression -> dropped_by_reason.excluded++ ; continue
          if per_company[c.company] >= max_per_company -> dropped_by_reason.company_cap++ ; continue
          email = c.email or findEmail(c)            -- waterfall 6.5
          if not email                                -> dropped_by_reason.no_email++ ; continue
          status = verifyAtExport(email)              -- chain 6.6, never cached result
          if status == bad                            -> dropped_by_reason.bad_email++ ; continue
          if status == risky and not allow_risky      -> dropped_by_reason.risky++ ; continue
          phone = order.include_phones ? findPhone(c) : null
          write order_item (charged = 1 + (phone ? 3 : 0)); per_company[c.company]++ ; delivered++
          if delivered == needed: break
      checkpoint progress to orders row (so a crash resumes, not restarts)
      if order.stop_requested: finalize as stopped

  charged = sum(order_items.charged)
  settle hold for charged; release the rest
  status = delivered == needed ? completed : partial   (shortfall = needed - delivered)
  emit event order.completed (or order.partial / order.failed)
```

### 9.3 Details that matter
- **Resumable:** the worker checkpoints after every batch. A restart reloads the order and continues from the saved cursor.
- **Concurrency per vendor:** bounded pool (for example 20 parallel verifier calls) with retry and backoff; a vendor outage opens a circuit breaker and falls through to the next vendor.
- **Cost guard:** stop an order if vendor spend per delivered contact exceeds a ceiling `[DESIGN]`, mark `partial`, refund the rest.
- **Two engines:** ListKit runs a legacy and a new engine side by side `[VERIFIED]`. Keep an `engine` column so a rewrite can roll out per order.
- **Download:** `GET /v1/orders/{id}/download?format=csv|json` streams `order_items` joined to people and companies. CSV columns: `first_name,last_name,email,email_status,title,company,domain,phone,linkedin_url,city,country`.
- **Import to campaign:** from a completed order, "Send to campaign" creates `campaign_leads` rows and (Phase 2) pushes them into the engine.

### 9.4 Outside-list verification `[VERIFIED]`
`POST /v1/verifications` takes a list the customer owns and runs the verification chain only, at 0.1 credit per email. Same hold/settle path, different job kind.

### 9.5 Exclusions
Customer can exclude emails, domains or companies, and the platform keeps a global `suppression` table (unsubscribes, hard bounces, complaints, legal requests) that no customer can override.

---

## 10. Domains and mailboxes

### 10.1 What a customer gets `[VERIFIED for ListKit]`
Per bundle: 20 domains, 40 Google Workspace inboxes (2 per domain), 25 emails/day per inbox after ramp, about 1,000 emails/day in total. Two kinds:
- **Pre-warmed:** `.info` domains from a shared pool, ready in minutes.
- **Branded:** customer's `.com`, about 72 hours setup then 14 days warmup.

### 10.2 Provisioning flow `[DESIGN]`
```
order domains -> register -> DNS (Cloudflare API) -> mailbox vendor creates inboxes
   -> verify SPF/DKIM/DMARC -> attach to engine (SmartLead) -> start warmup
   -> ramp -> ready
```
1. **Name suggestions:** from the customer's brand, generate lookalike sending domains (`getacme.com`, `tryacme.com`, `acme-hq.com`). Check availability through the registrar API. Do not generate names that impersonate another brand.
2. **Register** with the registrar API (Namecheap, Porkbun, Dynadot, Spaceship or similar) `[UNVERIFIED which have public registration APIs; check]`.
3. **DNS** through Cloudflare:
   - `MX` to the mailbox provider
   - `SPF`: `v=spf1 include:_spf.google.com ~all` (Google) or the provider's include
   - `DKIM`: the key the provider generates
   - `DMARC`: start `v=DMARC1; p=none; rua=mailto:dmarc@<ours>`, tighten later
   - Tracking subdomain `CNAME` if open/click tracking is on
   - A redirect from the bare sending domain to the customer's real site
4. **Mailboxes:** two per domain, human-looking names the customer chooses (`first.last`), with a profile photo and signature if the provider supports it.
5. **Health check** after DNS propagates: lookup SPF, DKIM selector and DMARC, confirm MX, confirm not on a blocklist, then mark `ready_for_warmup`.
6. **Attach to engine:** create the email account in SmartLead via API and enable warmup there.

### 10.3 Mailbox source options
| Option | Notes |
|---|---|
| Reseller (Zapmail and similar) | SmartLead's SmartSenders is powered by Zapmail `[VERIFIED]`: Google mailbox $4.50/month plus $13/year per domain, pre-warmed $9/month plus $18/year `[VERIFIED list prices]`. Fastest. API terms for resale **not checked** |
| Google Workspace reseller | Direct control, lower unit cost at volume. Needs reseller enrolment, per-domain verification, DKIM setup. Whether the Directory / Reseller APIs cover every step (especially DKIM key generation) is `[UNVERIFIED]` |
| Microsoft 365 | Graph API. Different spam model; useful for matching recipient ESP |

`[DESIGN]` Phase 3: reseller. Phase 5 or later: own Google Workspace reseller to cut mailbox COGS.

### 10.4 Pre-warmed pool `[VERIFIED concept]`
Keep an inventory of domains already warmed 14+ days and unassigned (`sending_domains.org_id is null`, `kind = 'prewarmed'`). On a customer order, assign two mailboxes per domain, rotate passwords and sender names, and change the DKIM selector if possible. A job tops the pool up when stock falls below a threshold. Inventory cost is the price of being "ready in minutes".

### 10.5 Retirement
Domains burn. Rules `[DESIGN]`: pause a mailbox when bounce rate over its last 100 sends exceeds 3 percent or complaint rate exceeds 0.1 percent; retire a domain after repeated pauses or a blocklist listing; replace automatically from the pool or by ordering a new one. On cancellation, keep domains for a grace period, then release.

### 10.6 Customer-owned vs platform-owned
Decide early who owns the domain `[DESIGN]`: **platform-owned during the subscription** is simplest (we control DNS and rotation). Offer a transfer-out on request after a minimum term. State this in the terms.

---

## 11. Warmup

### 11.1 Ramp `[VERIFIED for ListKit]`
| Sending day | 1 | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|
| Emails/day per inbox | 1 | 5 | 9 | 13 | 17 | 21 | 25 |

Instantly exposes the same idea as per-account settings `[VERIFIED]`: `warmup.limit`, `increment` (0 to 4 per day), `reply_rate`, `open_rate`, `important_rate`, `spam_save_rate`, `read_emulation`, `weekday_only`, plus `enable_slow_ramp` and `daily_limit` on the account.

### 11.2 Phase 2 to 4: use the vendor's warmup
SmartLead includes warmup. We set ramp limits through its API and read health back. Our job is to **not send campaign mail above the ramp**, enforced in our own layer even if the engine allows more.

### 11.3 Phase 6: our own warmup network `[DESIGN]`
- **Pool:** a set of real mailboxes (ours and, optionally, opted-in customers) that exchange mail.
- **Loop per mailbox per day:** send N warmup emails to random pool members, those recipients open, mark important, reply some percentage (`reply_rate`), move from spam to inbox, then reply back.
- **Content:** varied, realistic text generated in batches with an LLM and cached, never one fixed template. Fixed text is the first thing providers learn to detect.
- **Schedule:** weekdays, spread through the day, jittered gaps.
- **Metrics:** inbox placement per recipient provider, spam-folder rate, reply rate.
- **Honest limit:** warmup is a signal, not a guarantee. Providers can detect closed-loop networks, which is why real warmup networks need hundreds to thousands of mailboxes and constant change. This is the hardest piece to copy `[VERIFIED in research: "Hard: the warmup network"]`.

### 11.3b Deliverability rules that apply from day one
- Plain text first email, no images, minimal links.
- Open tracking off by default; link tracking off by default (they hurt placement). Instantly exposes `text_only`, `first_email_text_only`, `open_tracking`, `link_tracking` as flags `[VERIFIED]`, so default them to the safe setting.
- Max about 25 per inbox per day, 30 to 50 percent below provider limits.
- Spread sends: `email_gap` of several minutes plus `random_wait_max` `[VERIFIED field names in Instantly]`.
- Match recipient ESP to sender ESP where possible (`match_lead_esp`, `provider_routing_rules` `[VERIFIED]`).

---

## 12. Campaigns and sending

### 12.1 The `SendingEngine` interface
Everything campaign-related goes through one interface so SmartLead can be replaced.

```ts
interface SendingEngine {
  name: 'smartlead' | 'own';

  // email accounts
  addMailbox(m: MailboxInput): Promise<{ engineAccountId: string }>;
  setWarmup(engineAccountId: string, cfg: WarmupConfig): Promise<void>;
  getMailboxHealth(engineAccountId: string): Promise<MailboxHealth>;

  // campaigns
  createCampaign(c: CampaignInput): Promise<{ engineCampaignId: string }>;
  saveSequence(engineCampaignId: string, steps: Step[]): Promise<void>;
  saveSchedule(engineCampaignId: string, s: Schedule): Promise<void>;
  attachMailboxes(engineCampaignId: string, accountIds: string[]): Promise<void>;
  addLeads(engineCampaignId: string, leads: LeadInput[]): Promise<{ added: number; skipped: number }>;
  start(engineCampaignId: string): Promise<void>;
  pause(engineCampaignId: string): Promise<void>;
  deleteCampaign(engineCampaignId: string): Promise<'deleted' | 'delete_unconfirmed'>;

  // results
  getAnalytics(engineCampaignId: string): Promise<Analytics>;
  listThreads(engineCampaignId: string, cursor?: string): Promise<Page<Thread>>;
  reply(threadId: string, body: string): Promise<void>;
  setLeadCategory(engineCampaignId: string, leadId: string, category: string): Promise<void>;

  // webhooks into our system
  verifyAndParseWebhook(req: Request): Promise<EngineEvent[]>;
}
```
`delete_unconfirmed` mirrors ListKit's own error: "the campaign may still be sending" `[VERIFIED]`. Treat engine deletes as eventually consistent and surface that state.

### 12.2 SmartLead adapter (Phase 2) `[VERIFIED facts, endpoint names to confirm]`
- API base `https://server.smartlead.ai/api/v1`, needs a plan with API access (Pro and up).
- Reseller path: client workspaces, per-client API keys, "assign client to campaign" exist in SmartLead `[VERIFIED]`.
- SmartLead webhooks exist at user, client and campaign level `[VERIFIED]`. ListKit says one destination per account `[VERIFIED claim, unreconciled]`. We run **one inbound webhook endpoint of ours** and fan out to our customers' own webhooks, exactly what ListKit's relay does.
- A SmartLead campaign needs at least 1,000 leads before it can start in ListKit's setup `[VERIFIED for ListKit; check whether it is a ListKit rule or a SmartLead rule]`.
- Use the exact endpoint list from SmartLead's API docs when generating the adapter; this file does not copy it because it was not captured in full.

### 12.3 Campaign data model and settings `[VERIFIED: Instantly field names, adopted as our spec]`
Campaign:
- `campaign_schedule`: schedules with `days`, `from`, `to`, `timezone`
- `sequences` > `steps` (`delay`, `delay_unit`) > `variants` (`subject`, `body`, `disabled`). Variants are the A/Z test.
- Controls: `daily_limit`, `daily_max_leads`, `email_gap`, `random_wait_max`, `stop_on_reply`, `stop_on_auto_reply`, `stop_for_company`, `text_only`, `first_email_text_only`, `link_tracking`, `open_tracking`, `prioritize_new_leads`, `match_lead_esp`, `allow_risky_contacts`, `disable_bounce_protect`, `insert_unsubscribe_header`, `auto_variant_select`, `provider_routing_rules`, `is_evergreen`
- Senders attach by list or by tag; rotation spreads sends over them

Our defaults `[DESIGN]`: `stop_on_reply = true`, `stop_on_auto_reply = false`, `stop_for_company = true` (one reply from a company stops the rest of that company), `text_only = true`, `open_tracking = false`, `link_tracking = false`, `insert_unsubscribe_header = true`, `allow_risky_contacts = false`, bounce protect on.

### 12.4 Own sending engine (Phase 5) `[DESIGN]`
Build only after Phase 2 is earning. Components:

**Scheduler (runs every minute on the worker)**
```
for each campaign where status = active:
    if now not inside campaign.schedule (campaign timezone, allowed days, from/to): continue
    mailboxes = campaign mailboxes where status = ready
                and sent_today < daily_limit_for_ramp(mailbox)
                and now - last_sent_at >= email_gap + random(0, random_wait_max)
    due = campaign_leads where status = active and next_send_at <= now
          order by (prioritize_new_leads ? current_step asc : next_send_at asc)
          limit (sum of remaining mailbox quota, campaign.daily_max_leads - sent_today)
    for lead in due:
        mailbox = pick(mailboxes, lead)         -- ESP match first, else least recently used
        claim slot atomically (UPDATE ... WHERE sent_today < limit RETURNING)
        enqueue job send_email(lead, step, mailbox, variant)
```
**Send job**
1. Check suppression and unsubscribe again at send time. Never trust the queue.
2. Choose variant (`auto_variant_select`: weighted by reply rate once enough sends).
3. Render merge fields (`{{first_name}}`, `{{company}}`, custom vars) with fallbacks. Expand spintax (`{Hi|Hey|Hello}`), deterministic per lead so a retry renders the same text.
4. Build the message: `Message-ID`, `In-Reply-To` and `References` for steps 2+ so follow-ups thread, `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), plain-text body with an unsubscribe line.
5. Send via Gmail API or SMTP with the mailbox credentials. Record the `messages` row first, with the unique `(campaign_lead_id, step_no, 'out')` key, so a crash cannot double-send.
6. Update `next_send_at` for the next step (`delay_days`, moved to the next valid schedule window), `current_step`, counters.

**Rotation and limits:** per-mailbox token bucket (`daily_limit` from ramp), per-domain cap, per-recipient-domain cap (do not send 30 mails to one company in a day), global kill switch.

**Bounce handling:** parse DSN replies. Hard bounce (5.1.x, "user unknown") means `status = bounced`, `suppression` insert, `person_emails.status = bad`. Soft bounce (4.x.x, mailbox full) retries later, converts to hard after N tries. **Bounce protect:** if a campaign bounces more than 3 percent over its last 100 sends, pause it and alert `[DESIGN thresholds]`.

**Tracking (optional):** open pixel and click redirects on a per-customer tracking subdomain (never our main domain). Off by default (11.3b).

**Unsubscribe:** one-click header plus a hosted page `/u/<token>`. Unsubscribe is instant and global for that email across the whole platform (suppression table), not only that campaign.

### 12.5 Reply detection (Phase 5)
- Gmail: `users.watch` with Pub/Sub push, then `history.list` to fetch new messages. Fallback to polling every few minutes.
- IMAP IDLE for non-Google mailboxes.
- Match a reply to a thread by `In-Reply-To` / `References`, fall back to subject + sender. Mark `campaign_leads.status = 'replied'`, stop the sequence (`stop_on_reply`), run classification (section 14), emit `reply_received`.
- Auto-replies and out-of-office: detect by headers (`Auto-Submitted`, `X-Autoreply`, `Precedence: bulk`) and by LLM; do not count as a real reply.

---

## 13. Inbox ("unibox")

- One list of all threads across all campaigns and mailboxes, filter by category, mailbox, campaign.
- Categories `[VERIFIED Instantly webhook names]`: interested, not interested, neutral, auto reply, plus ours: meeting booked, wrong person, out of office, unsubscribe request, bounce.
- Actions: reply from the same mailbox (threaded), forward, change category, mark done, snooze, add to exclusion, push to CRM or webhook.
- Inbox API in ListKit: threads, reply, forward, uses the engine's campaign id `[VERIFIED]`. Same shape for us.
- Hand-off to your own **Enquiry Engine**: an "interested" reply can fire a webhook that creates a lead in the ATOMZ Enquiry Engine so the owner alert and follow-up logic already built there is reused.

---

## 14. AI features

| Feature | Credits | Model | Notes |
|---|---|---|---|
| Script Writer | 100 `[VERIFIED]` | Claude Sonnet 5.5 | Inputs: offer, ICP, proof, CTA, tone, language. Output: 3 to 4 step sequence, 2 variants per step, spintax |
| Spintax | 0 `[VERIFIED]` | Claude Haiku 5.5 | Rewrites a given text with `{a|b}` options, preserves merge fields |
| Reply classification | 0 | Claude Haiku 5.5 | One call per inbound message, returns category + confidence |
| AI search | 0 | Claude Haiku 5.5 | Sentence to filter JSON (section 7.2) |
| Suggested reply | 0 | Claude Sonnet 5.5 | Drafts only, human sends |

Guardrails for generated copy `[DESIGN]`: first email 50 to 120 words, plain text, one question or one CTA, no spam trigger phrases, no false claims about the sender, no impersonation, always include the sender's real company and an unsubscribe line. A post-generation lint step rejects drafts that break these rules and regenerates.

Classification prompt shape: system text that defines each category with two examples, user text containing the reply only, JSON-only response `{category, confidence, reason}`. Store the model id and prompt version with each classification so it can be audited.

Prompt-injection note: inbound replies are untrusted input. Never let reply text change system behaviour, send mail or call tools; the classifier has no tools.

---

## 15. Public API, webhooks and MCP

### 15.1 Conventions `[VERIFIED style, our names]`
- Base `https://api.<ourdomain>/v1`, `Authorization: Bearer <key>`, JSON, OpenAPI 3.1 spec published and used to generate docs and a typed client.
- `Idempotency-Key` header on every POST that spends or creates.
- Errors: `{ "error": { "code": "insufficient_credits", "message": "...", "request_id": "..." } }`. Codes include `insufficient_credits`, `order_in_progress`, `cap_exceeded`, `rate_limited`, `delete_unconfirmed`, `validation_error`, `not_found`, `forbidden`.
- Pagination: cursor based.
- Rate limits: token bucket per account by class `[VERIFIED classes]`: `read`, `write`, `search`, `spend`, `chat`, `insights`. Return `429` with `Retry-After`.

### 15.2 Resources `[VERIFIED resource list; paths are our design]`
| Resource | Endpoints |
|---|---|
| account | `GET /v1/account` |
| billing | `GET /v1/billing`, `POST /v1/billing/topups` |
| keys | `GET/POST /v1/keys`, `DELETE /v1/keys/{id}` (max 25 active) |
| search | `POST /v1/search/people`, `/companies`, `/counts`, `/insights`; `GET /v1/search/intent-topics`; `POST /v1/search/job-title-expansion`; `POST /v1/search/ai` |
| orders | `POST /v1/orders/estimate`, `POST /v1/orders`, `GET /v1/orders`, `GET /v1/orders/{id}`, `POST /v1/orders/{id}/stop`, `GET /v1/orders/{id}/download` |
| verifications | `POST /v1/verifications`, `GET /v1/verifications/{id}` |
| enrichment | `POST /v1/enrichment/email`, `/phone`, `/company` |
| leads | `GET/POST /v1/leads`, `PATCH /v1/leads/{id}`, `POST /v1/campaigns/{id}/leads` |
| exclusions | `GET/POST/DELETE /v1/exclusions` |
| domains | `POST /v1/domains/search`, `POST /v1/domains/orders`, `GET /v1/domains`, `GET /v1/domains/prewarmed` |
| mailboxes | `GET /v1/mailboxes`, `PATCH /v1/mailboxes/{id}` (pause, name), never returns credentials |
| campaigns | `GET/POST /v1/campaigns`, `GET/PATCH/DELETE /v1/campaigns/{id}`, `PUT /v1/campaigns/{id}/sequence`, `PUT /v1/campaigns/{id}/schedule`, `PUT /v1/campaigns/{id}/senders`, `POST /v1/campaigns/{id}/start`, `/pause`, `GET /v1/campaigns/{id}/analytics`, `POST /v1/campaigns/{id}/ai/script`, `POST /v1/campaigns/{id}/ai/spintax` |
| inbox | `GET /v1/inbox/threads`, `GET /v1/inbox/threads/{id}`, `POST /v1/inbox/threads/{id}/reply`, `/forward`, `PATCH` (category) |
| webhooks | `GET/POST /v1/webhooks`, `DELETE /v1/webhooks/{id}`, `POST /v1/webhooks/{id}/test` |
| workflows | `GET/POST /v1/workflows` (trigger + action rules, for example "interested reply" then webhook) |

### 15.3 Webhook events `[VERIFIED names from Instantly and ListKit, our subset]`
`order.completed`, `order.partial`, `order.failed`, `email_sent`, `email_opened`, `link_clicked`, `reply_received`, `auto_reply_received`, `email_bounced`, `lead_unsubscribed`, `lead_interested`, `lead_not_interested`, `lead_neutral`, `campaign_completed`, `mailbox_error`, `mailbox_paused`, `domain_blacklisted`.

Delivery: POST JSON with headers `X-Signature: sha256=<hmac(secret, body)>`, `X-Event-Id`, `X-Timestamp`. Retry with exponential backoff for 24 hours, then mark the endpoint `failing`. Customers verify the signature and ignore duplicate event ids.

### 15.4 Our webhook relay
One inbound endpoint receives SmartLead events (Phase 2) and later our own engine's events. It verifies the source, normalises the event, writes `events`, and fans out to customer endpoints. This is the same reason ListKit built a relay `[VERIFIED]`.

### 15.5 MCP server `[VERIFIED pattern]`
- Remote MCP at `https://api.<ourdomain>/mcp` (Streamable HTTP, OAuth or API key).
- Tools mirror the REST actions: `search_people`, `estimate_order`, `create_order`, `get_order`, `list_campaigns`, `create_campaign`, `write_script`, `start_campaign`, `list_threads`, `reply_to_thread`, `list_mailboxes`, `verify_list`, etc.
- **Hard exclusions, same as ListKit `[VERIFIED]`:** no payment actions, no mailbox passwords, no key creation, no domain purchase without a human confirmation step.
- Spending tools take a `confirm` field and return a quote first. Claude proposes, the human approves.
- Return compact summaries by default; let the caller ask for full data.

---

## 16. Frontend

### 16.1 Pages
| Page | What is on it |
|---|---|
| Onboarding | Wizard: 1 company and offer, 2 domains and inboxes, 3 find leads, 4 write sequence, 5 review and launch. Progress bar. Warmup status explained in plain words |
| Dashboard | Credits left, sends today vs capacity, replies, mailbox health, one "do next" card |
| Search | Filter sidebar, results table with masked emails, live pool estimate, "Estimate and order" bar fixed at the bottom |
| Lists and Orders | Orders with status chips, shortfall explained, download, send to campaign |
| Campaigns | List with sparkline stats. Builder tabs: Leads, Sequence (steps and variants), Schedule, Senders, Settings, Analytics |
| Inbox | Split view: thread list left, conversation right, category buttons, keyboard shortcuts |
| Domains and Mailboxes | Table with status, warmup day, health score, DNS checks, pause/replace |
| Billing | Plan, bundle count, credits and expiry, top-up, invoices |
| Settings | API keys, webhooks, exclusions, team, white-label (later) |
| Admin (internal) | Abuse queue, vendor spend and margin, pool inventory, kill switches |

### 16.2 Design direction (your preference: premium, not a chatbot look)
- Modern, calm, high-contrast UI, generous spacing, one strong accent colour, tabular numbers for credits and counts.
- Empty states that teach ("You have 0 leads. Search, or upload a CSV").
- Everything slow (orders, provisioning) shows a progress state and an ETA, never a spinner alone.
- Credit cost is always visible before any action that spends.
- Dark and light modes. Mobile-friendly inbox.
- Build with shadcn/ui + Tailwind, or generate a design system first in Figma or Claude Design and implement from it.

---

## 17. Security, multi-tenancy and abuse

### 17.1 Security basics
- RLS on every tenant table. Test it: a user from org A must get zero rows from org B on every table.
- Secrets: mailbox credentials encrypted with envelope encryption (KMS or libsodium key from the environment), decrypted only in the worker, never logged, never sent to the browser or MCP.
- API keys hashed. Webhook secrets random per endpoint.
- Rate limiting at the edge and per account. Request size limits.
- Audit log for sensitive actions (key created, domain bought, order placed, bundle changed).
- Backups on, and a tested restore.
- Dependency scanning, secret scanning in CI.

### 17.2 Abuse prevention (this is a spam-adjacent product; treat it seriously)
Cold-email platforms attract spammers, scammers and phishers. One abusive customer can burn shared domains, get the platform's vendor accounts suspended and create legal exposure.

Controls `[DESIGN]`:
1. **No free trial, payment before provisioning** `[VERIFIED ListKit has no free trial]`.
2. **KYC-lite:** business name, website, use case, company email domain (no free webmail), manual review of first campaign.
3. **Content scan** on every sequence before launch: phishing patterns, adult or illegal offers, deceptive subject lines, missing opt-out. Block and flag.
4. **Live thresholds:** pause a mailbox at bounce above 3 percent or complaints above 0.1 percent; pause the account if more than X mailboxes trip.
5. **Complaint and abuse pages:** public `report abuse` and `opt-out` pages `[VERIFIED: Instantly has /privacy/opt-out and report abuse routes]`. Process within 24 hours.
6. **Global suppression** that no customer can bypass.
7. **Restricted verticals:** adult, gambling, crypto promotion, health claims, financial scams are prohibited in the terms and scanned for.
8. **Kill switches:** per campaign, per mailbox, per account, global.
9. **Sender identity:** every email must carry the real sending business name and a valid postal address (see 18).

---

## 18. Compliance (not legal advice; get a lawyer before launch)

| Regime | What it asks of cold email |
|---|---|
| **US CAN-SPAM** | Accurate From/Subject, real physical postal address, clear opt-out, honour opt-out within 10 business days, no harvested-address tricks. Penalties apply per message `[well known; check the current amount]` |
| **Gmail and Yahoo bulk-sender rules** (from 2024) | SPF, DKIM and DMARC aligned, one-click unsubscribe header, keep spam-complaint rate under 0.3 percent and aim under 0.1 percent. Our infrastructure checks in 10.2 and 12.4 exist for this |
| **EU GDPR and UK PECR** | Stricter. B2B email to individual corporate subscribers is treated differently by country; legitimate-interest assessment, a data source notice and an easy objection route are needed. Default to excluding EU/UK in v1 unless counsel signs off |
| **India DPDP Act 2023** | Personal data processing needs a lawful basis, notice and rights handling. The implementation rules are phased in; check the current status `[UNVERIFIED]` |
| **Canada CASL** | Strict consent rules for commercial messages. Exclude Canada by default in v1 |
| **Data provider terms** | Resale and caching rights per vendor (section 6.2). Read before ingesting |

Product features that implement compliance:
- Hosted privacy notice stating where contact data comes from (ListKit publishes one: "data providers", "data brokers, public sources, third-party vendors" `[VERIFIED]`).
- Data subject tools: search by email, export, delete, and add to suppression across the whole platform.
- Per-country exclusion toggles on every order and campaign.
- Mandatory sender postal address and unsubscribe line in the template.
- Provenance on every record (`source`, `fetched_at`) so deletion and disputes can be answered.

---

## 19. Pricing and unit economics

### 19.1 Reference points `[VERIFIED]`
| Item | Price |
|---|---|
| ListKit Bundle (40 inboxes, 20 domains, ~1,000/day, 10,000 credits) | $597/mo |
| Instantly Growth (bring your own inboxes) | $47/mo, 5,000 emails/mo |
| SmartLead Pro | $94/mo |
| Zapmail-style Google mailbox via SmartLead | $4.50/mo |
| Domain (via SmartLead SmartSenders) | $13/yr |
| Credit top-up (ListKit) | 2,000 for $47 = $0.0235 per credit |

### 19.2 Our cost of a ListKit-equivalent bundle at list prices `[ESTIMATE from research 6.5]`
- SmartLead Pro $94
- 40 mailboxes at $4.50 = $180
- 20 domains at $13/yr = about $22/mo
- **About $296/mo** before data. With SmartLead's own prospect add-on about $355.
- Data for 10,000 credits at a half cent to a cent each: $50 to $100.
- Payments (Stripe) about 3 percent, support, hosting.

Against a $597 price that is roughly 40 to 50 percent gross margin before support. **You cannot beat ListKit on price using the same parts.** The levers are:
1. Own mailbox provisioning (reseller programme) to cut the $180 line.
2. Niche data (India, local businesses) at a much lower cost than a general database.
3. A local-currency price and local support for Indian and Gulf customers.
4. Fewer inboxes sold at a lower entry tier (for example 10 inboxes, 5 domains).

### 19.3 Pricing structure for us `[DESIGN, numbers are placeholders to test]`
| Tier | Contents | Purpose |
|---|---|---|
| Starter | 5 domains, 10 inboxes, ~250/day, 2,500 credits | Lower entry than ListKit's $597 |
| Bundle | Same as ListKit (20 / 40 / 1,000 per day / 10,000) | Parity |
| Stack | Multiples of Bundle | Agencies |
| Top-up | Credits only | Margin |
| Done-for-you | Setup + copy + management fee | Highest margin, your agency revenue |

Price each tier at cost / (1 minus target margin). Set the target gross margin to 55 to 65 percent and see which tiers survive. If a tier does not, change its contents, not its margin.

### 19.4 Metrics to track from day one
Gross margin per org, vendor cost per delivered contact, credits sold vs consumed, mailbox burn rate (domains retired per month), reply rate per customer, churn, support tickets per 100 mailboxes.

---

## 20. Build plan, phase by phase

Each phase lists the goal, deliverables, **definition of done**, and a prompt to paste into Claude Code.

### Phase 0: validate before coding (no code)
Goal: prove people pay for outbound before building the platform.
- Sell "done-for-you outbound" to 3 pilot clients (Indian B2B, agencies, gyms and clinics in your area) using Instantly ($47 Growth) or SmartLead ($94 Pro) with bought domains and mailboxes.
- Use the Reverse Engineering notes and Remotion personalised video as differentiators.
- **Done when:** 2 to 3 paying pilots, you know their average reply rate and their biggest pains.

### Phase 1: data, credits, orders (no sending yet)
Deliverables: auth and orgs, Stripe bundle + top-up, credit ledger, search UI over a seed dataset, estimate, order pipeline with a mock verifier, CSV download, admin page.
**Done when:** a test org can search, estimate, place an order, see a partial result, and download a CSV; the ledger invariant test passes; killing the worker mid-order and restarting completes the order once.

Prompt:
> Read "BUILD LISTKIT blueprint.md", sections 3 to 9. Build Phase 1. Next.js 15 + TypeScript + Supabase + Stripe. Start with a plan listing the files you will create. Implement the schema from section 4 as migrations, the ledger from 8.2 with tests for the invariant, the order worker from 9.2 with a mock data adapter and a mock verifier behind interfaces, and the Search, Orders and Billing pages. Do not integrate real vendors yet.

### Phase 1b: real data and verification
Deliverables: first real data adapter (option C Google Places or option B user-supplied key), finder and verifier adapters behind interfaces, vendor cost tracking, pass-rate table.
**Done when:** a real order of 1,000 contacts delivers and the measured data cost per delivered contact is known.

Prompt:
> Read sections 6 and 9. Implement `DataSource`, `EmailFinder` and `EmailVerifier` interfaces and one real adapter for each. Record `vendor_cost_usd` on every call. Add the waterfall from 6.5 and the verification chain from 6.6. Add a script that runs a 1,000-contact order against the staging database and prints cost per delivered contact and drop reasons.

### Phase 2: campaigns, inbox, SmartLead
Deliverables: `SendingEngine` interface, SmartLead adapter (mailbox, campaign, sequence, schedule, leads, start/pause, analytics, threads, reply), webhook relay, campaign builder UI, unibox, reply classification, unsubscribe page.
**Done when:** from an order, a user creates a campaign, sends to a seed list of owned addresses on a test SmartLead account, receives a reply, sees it classified in the inbox, and a hard bounce is added to suppression.

Prompt:
> Read sections 12 to 14. Build Phase 2. Define the `SendingEngine` interface exactly as in 12.1 and implement a `SmartLeadEngine` from SmartLead's public API docs (fetch them, do not guess endpoints) plus a `FakeEngine` that records calls for tests. Build the campaign builder, the webhook relay, the Inbox page and the Haiku-based classifier. All sending in dev and staging must go through the `FakeEngine` or a test account.

### Phase 3: domains and mailboxes
Deliverables: domain search and purchase, Cloudflare DNS automation, mailbox vendor adapter, DNS health checks, ramp enforcement, pre-warmed pool and allocation, retirement jobs, Domains and Mailboxes UI, onboarding wizard.
**Done when:** a paying test org gets 2 domains and 4 inboxes ready for warmup without manual steps, and a broken DNS record is detected and reported.

Prompt:
> Read sections 10 and 11. Build Phase 3. Implement `Registrar`, `DnsProvider` (Cloudflare) and `MailboxVendor` interfaces with one real adapter each, plus sandbox fakes. Implement the provisioning job from 10.2 as a resumable state machine, DNS health checks, the ramp table from 11.1, the pre-warmed pool from 10.4 and the pause/retire rules from 10.5. Never log credentials.

### Phase 4: public API, webhooks, MCP
Deliverables: OpenAPI spec, API key auth with scopes, token-bucket limits by class, idempotency middleware, customer webhooks with signing and retries, remote MCP server, docs site.
**Done when:** Claude (via MCP) can find leads, estimate and place an order after human confirmation, create and start a campaign, and read replies; payment and credential tools are provably absent.

Prompt:
> Read section 15. Build Phase 4. Generate the OpenAPI spec first and implement routes from it. Add key auth, the six rate-limit classes, idempotency keys and signed webhook delivery with retries. Build the MCP server with the tools in 15.5, a confirm/quote step for spending tools, and tests that assert no payment, key-creation or credential tool exists.

### Phase 5: own sending engine
Deliverables: `OwnEngine` implementing `SendingEngine`, scheduler, send job, bounce parsing, reply detection (Gmail push + IMAP), tracking subdomains, unsubscribe, bounce protect.
**Done when:** a campaign of 500 emails sends from 10 owned mailboxes in shadow mode alongside SmartLead with matching counts, then switches over for one internal campaign with zero double-sends.

Prompt:
> Read sections 12.4 and 12.5. Implement `OwnEngine`. Start with the scheduler as a pure function with property tests (no mailbox over its limit, no send outside schedule, no double send). Then the send job with the unique message key, bounce parsing, Gmail push and IMAP reply detection. Run it in shadow mode first.

### Phase 6: warmup network and own data
Only after revenue. Warmup peer pool (11.3), mailbox reseller or Google reseller for lower COGS, bigger licensed data or an owned dataset, search engine upgrade (Typesense or ClickHouse).

---

## 21. Testing

| Area | Tests |
|---|---|
| Credits | Ledger invariant, concurrent holds, retry idempotency, expiry order, settle and release maths |
| Orders | Resume after crash, partial and shortfall, stop mid-order, company cap, already-bought skip, risky opt-in |
| Search | Filter to SQL parity, AI search parsing, masked emails |
| RLS | For each tenant table, a user in org A reads and writes nothing in org B |
| Billing | Stripe webhook replays, failed payment, bundle change, top-up |
| Engine | `FakeEngine` contract tests run against `SmartLeadEngine` (with a test account) and `OwnEngine` |
| Scheduler | Property tests: limits, windows, timezones, DST, no double send |
| Deliverability | Seed inbox tests per provider, blocklist lookups, SPF/DKIM/DMARC checks, a spam-score check on every default template |
| Webhooks | Signature verify, retry schedule, duplicate delivery |
| MCP | Excluded tools absent, confirm gate enforced, injection text in a reply cannot trigger an action |
| Load | 10,000 queued sends, 50 parallel orders, scheduler tick under one second |
| Security | Key hashing, secret redaction in logs, SSRF check on webhook URLs (block private IPs) |

---

## 22. Operations

- **Monitoring:** order throughput and failure rate, vendor latency and error rate, queue depth, sends per mailbox per day, bounce and complaint rates, webhook failure rate, Stripe webhook lag.
- **Alerts:** vendor circuit open, queue stuck more than 10 minutes, any mailbox paused, domain blacklisted, order failing repeatedly, margin below target.
- **Runbooks:** vendor outage, blocklisted domain (replace and root-cause), customer abuse (pause and review), Stripe outage, data deletion request, credit dispute (use the ledger).
- **Support:** onboarding call (ListKit offers one `[VERIFIED]`), help centre, a private community (ListKit uses one on Whop `[VERIFIED]`).
- **Costs to watch:** vendor spend, mailbox and domain spend, hosting, Stripe fees, and unused pre-warmed inventory.

---

## 23. Go to market for you

1. **Start as an agency, not a SaaS** (Phase 0). The research showed ListKit is "a packaging business: the margin comes from bundling and hand-holding, not from new technology".
2. **Pick a niche you can reach:** Indian B2B services, coaches, clinics, gyms, and agencies around Thane and Mumbai. Your ATOMZ products already serve small businesses.
3. **Offer a result, not a tool:** "10 booked calls in 30 days" with your Enquiry Engine handling the replies and your Remotion work producing personalised video intros.
4. **Convert the agency into the platform** when 5 or more clients repeat the same steps. Those steps are the product spec.
5. **Keep REA for competitor teardowns** to keep learning what the market sells.

---

## 24. Risks and unknowns

| Risk | Detail | Mitigation |
|---|---|---|
| Data supply | Base data vendor of ListKit is unknown; resale terms of common vendors likely forbid it `[UNVERIFIED]` | Option D hybrid, get written licence before reselling |
| Vendor dependence | SmartLead and the mailbox reseller can change prices or terms, or reject reselling | `SendingEngine` and `MailboxVendor` interfaces, plan Phase 5 |
| Deliverability | Providers change filters; shared infrastructure can be burned by one bad customer | Abuse controls (17.2), pause thresholds, domain rotation, seed testing |
| Legal | Cold email law varies by country, GDPR and DPDP exposure | Lawyer review, exclude EU/UK/Canada at launch, suppression, notices |
| Margin | Same parts as ListKit give roughly 40 to 50 percent gross margin at list prices | Own mailboxes, niche data, local pricing |
| Warmup | Needs a large pool to look natural | Use vendor warmup until Phase 6 |
| Unknown internals | "Triple" verification meaning, ListKit's domain vendor, one SmartLead account vs per customer, why one webhook per account | Our own definitions in this file are `[DESIGN]`, not copies |
| Scope | Building every layer at once | Phase gates and the agency-first path |

### Things this file does not know
- SmartLead's complete endpoint list and exact field names (fetch from their docs when building Phase 2).
- Reseller API terms for any mailbox vendor.
- Which registrars offer registration APIs to a platform like ours.
- Current exact penalty amounts and the current status of India's DPDP rules.
- Anything behind login in ListKit, Instantly or SmartLead.

---

## 25. Appendices

### A. Environment variables
```
# core
DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
APP_URL, API_URL, ENCRYPTION_KEY            # envelope key for mailbox credentials
# billing
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_BUNDLE, STRIPE_PRICE_TOPUP
# email (app mail)
RESEND_API_KEY
# AI
ANTHROPIC_API_KEY                           # models: claude-sonnet-5-5 (copy), claude-haiku-5-5 (classify)
# data and verification vendors
DATA_VENDOR_A_KEY, FINDER_LEADMAGIC_KEY, FINDER_TRYKITT_KEY
VERIFIER_MILLIONVERIFIER_KEY, VERIFIER_ATDATA_KEY
# infrastructure vendors
SMARTLEAD_API_KEY (or per-client keys), SMARTLEAD_WEBHOOK_SECRET
CLOUDFLARE_API_TOKEN, REGISTRAR_API_KEY, MAILBOX_VENDOR_API_KEY
# ops
SENTRY_DSN, ADMIN_EMAILS
```

### B. Repo layout `[DESIGN]`
```
/apps/web            Next.js app and REST /v1 routes
/apps/worker         jobs: orders, provisioning, webhooks, (later) sending
/packages/db         migrations, typed queries
/packages/engine     SendingEngine interface + SmartLeadEngine + FakeEngine (+ OwnEngine)
/packages/data       DataSource, EmailFinder, EmailVerifier adapters
/packages/infra      Registrar, DnsProvider, MailboxVendor adapters
/packages/ai         script writer, classifier, search parser, prompts (versioned)
/packages/mcp        MCP server
/packages/sdk        generated typed API client
/docs                OpenAPI spec, runbooks
```

### C. Reply category map
| Our category | Typical trigger | Action |
|---|---|---|
| interested | asks price, call, details | Stop sequence, alert owner, push to CRM/webhook |
| meeting_booked | calendar link used or confirmed time | Stop, tag |
| not_interested | "no thanks", "not a fit" | Stop, no more emails to that company if `stop_for_company` |
| neutral | question without intent | Keep in inbox, no auto-stop |
| ooo | out-of-office text | Delay next step by the return date |
| auto_reply | headers or generic autoresponder | Do not count as reply |
| wrong_person | "not me, try X" | Stop, offer to add the referred contact |
| unsubscribe | "remove me", "stop" | Suppress globally, instantly |
| bounce | DSN | Hard: suppress and mark email bad. Soft: retry |

### D. Launch checklist
- [ ] 2 to 3 paying pilots (Phase 0)
- [ ] Data source licence or niche dataset in place and terms read
- [ ] Verifier and finder vendors under contract, cost per contact measured
- [ ] Credit ledger invariant test green in CI
- [ ] RLS test green for every tenant table
- [ ] Stripe live mode, webhooks verified, tax settings checked
- [ ] SPF, DKIM, DMARC pass on every sending domain
- [ ] Unsubscribe header and page work, suppression is global
- [ ] Abuse controls live (content scan, thresholds, kill switches, report page)
- [ ] Privacy notice, terms and acceptable-use policy reviewed by a lawyer
- [ ] Postal address and opt-out in every default template
- [ ] Monitoring and alerts live, restore from backup tested
- [ ] Onboarding call script and help articles written
- [ ] First 10 customers hand-onboarded

### E. Glossary
- **Credit:** unit of spend. 1 per verified email.
- **Hold:** credits reserved for an order before it runs.
- **Shortfall:** quantity ordered minus quantity delivered.
- **Catch-all:** a domain that accepts all addresses, so deliverability can't be proven (`risky`).
- **Ramp:** daily send limit rising as a mailbox warms.
- **Pre-warmed pool:** inventory of domains already warmed and unassigned.
- **Suppression:** global list of addresses that must never be emailed.
- **Spintax:** `{a|b|c}` text that picks one option per email.
- **Engine:** the system that actually sends (SmartLead now, our own later).
