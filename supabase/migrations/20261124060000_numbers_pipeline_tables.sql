-- Milestone 1: tables for the numbers pipeline.
-- companies → filings, financial_facts → ratios → red_flags, plus ingestion_runs.
-- Decisions behind this design: docs/decisions.md (2026-11-24).

-- ---------------------------------------------------------------------------
-- Keep updated_at current on rows that get updated in place.
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- companies: one row per company in the test set.
-- ---------------------------------------------------------------------------
create table public.companies (
  id bigint generated always as identity primary key,
  cik text not null unique check (cik ~ '^\d{10}$'),        -- 10-digit, zero-padded
  ticker text not null unique,
  name text not null,
  sic_code text,                                            -- SEC industry code, e.g. 5331
  sector_profile text not null,                             -- which metric profile to use, e.g. 'retail'
  fiscal_year_end text check (fiscal_year_end ~ '^\d{2}-\d{2}$'), -- MM-DD as reported by the SEC
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- filings: 10-Ks in the ingestion window (--from / --to).
-- fiscal_year = the calendar year in which most of the fiscal year's months
-- fall (a year ending 2026-01-31 is 2025), never the SEC's `fy` field.
-- ---------------------------------------------------------------------------
create table public.filings (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete cascade,
  accession_no text not null unique check (accession_no ~ '^\d{10}-\d{2}-\d{6}$'),
  form text not null,                                       -- '10-K' in v1
  fiscal_year int not null,
  period_end date not null,
  filed_at date not null,
  primary_document text not null,                           -- e.g. wmt-20260131.htm; URL built in code
  storage_path text,                                        -- raw HTML in the raw-filings bucket, once downloaded
  status text not null default 'pending'
    check (status in ('pending', 'downloaded', 'parsed', 'embedded', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index filings_company_year_idx on public.filings (company_id, fiscal_year);

create trigger filings_set_updated_at
  before update on public.filings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- financial_facts: annual XBRL facts for every year available.
-- Each 10-K repeats prior years, so one period can be reported by several
-- filings. One row per (company, concept, unit, period); the value kept is
-- the most recently filed one (restatements win), and accession_no/filed_at
-- record which filing supplied it. accession_no isn't a foreign key: facts
-- come from 10-Ks outside the ingestion window too.
-- ---------------------------------------------------------------------------
create table public.financial_facts (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete cascade,
  concept text not null,                                    -- e.g. 'us-gaap:Revenues'
  unit text not null,                                       -- 'USD', 'USD/shares', 'shares'
  value numeric not null,
  period_start date,                                        -- null for point-in-time values (balance sheet)
  period_end date not null,
  fiscal_year int not null,                                 -- from the period dates, same rule as filings
  accession_no text not null,
  filed_at date not null,
  form text not null,
  check (period_start is null or period_start <= period_end),
  -- NULLS NOT DISTINCT: two point-in-time facts (period_start null) for the
  -- same date count as duplicates instead of both being allowed.
  constraint financial_facts_one_per_period
    unique nulls not distinct (company_id, concept, unit, period_start, period_end)
);

create index financial_facts_company_year_idx on public.financial_facts (company_id, fiscal_year);
create index financial_facts_company_concept_idx on public.financial_facts (company_id, concept);

-- ---------------------------------------------------------------------------
-- ratios: one value per metric per fiscal year, from the sector profile.
-- ---------------------------------------------------------------------------
create table public.ratios (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete cascade,
  fiscal_year int not null,
  metric text not null,                                     -- e.g. 'gross_margin'
  status text not null check (status in ('ok', 'not_applicable')),
  value numeric,
  reason text,                                              -- why it's not applicable
  inputs jsonb not null default '{}'::jsonb,                -- facts used, for traceability
  profile text not null,                                    -- sector profile that produced it
  computed_at timestamptz not null default now(),
  constraint ratios_one_per_metric unique (company_id, fiscal_year, metric),
  -- "Missing data never guesses": ok rows have a value; not_applicable rows
  -- have a reason and no value.
  constraint ratios_status_matches_value check (
    (status = 'ok' and value is not null and reason is null)
    or (status = 'not_applicable' and value is null and reason is not null)
  )
);

-- ---------------------------------------------------------------------------
-- red_flags: rules from the sector profile that fired for a fiscal year.
-- ---------------------------------------------------------------------------
create table public.red_flags (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete cascade,
  fiscal_year int not null,
  rule text not null,                                       -- e.g. 'receivables_outpace_revenue'
  detail text not null,                                     -- e.g. 'AR +19% vs revenue +5%'
  evidence jsonb not null default '{}'::jsonb,              -- the numbers that triggered it
  detected_at timestamptz not null default now(),
  constraint red_flags_one_per_rule unique (company_id, fiscal_year, rule)
);

-- ---------------------------------------------------------------------------
-- ingestion_runs: one row per `npm run ingest`, including failed ones.
-- company_id can be null if the run failed before the company was found.
-- ---------------------------------------------------------------------------
create table public.ingestion_runs (
  id bigint generated always as identity primary key,
  company_id bigint references public.companies (id) on delete set null,
  ticker text not null,
  params jsonb not null default '{}'::jsonb,                -- e.g. {"from": 2023, "to": 2025}
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  step text,                                                -- last step reached
  counts jsonb not null default '{}'::jsonb,                -- filings, facts, ratios...
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check (finished_at is null or finished_at >= started_at)
);

create index ingestion_runs_started_idx on public.ingestion_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Access control.
-- The publishable key (used in the browser) acts as the `anon` role. RLS is
-- on everywhere; the five public-data tables get a read-only policy, and
-- ingestion_runs gets none. Only the secret key (which bypasses RLS) writes.
-- Grants are tightened too, so a missing policy can never mean write access.
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.filings enable row level security;
alter table public.financial_facts enable row level security;
alter table public.ratios enable row level security;
alter table public.red_flags enable row level security;
alter table public.ingestion_runs enable row level security;

revoke all on public.companies, public.filings, public.financial_facts,
  public.ratios, public.red_flags, public.ingestion_runs
  from anon, authenticated;

grant select on public.companies, public.filings, public.financial_facts,
  public.ratios, public.red_flags
  to anon, authenticated;

create policy "Public read" on public.companies for select to anon, authenticated using (true);
create policy "Public read" on public.filings for select to anon, authenticated using (true);
create policy "Public read" on public.financial_facts for select to anon, authenticated using (true);
create policy "Public read" on public.ratios for select to anon, authenticated using (true);
create policy "Public read" on public.red_flags for select to anon, authenticated using (true);
