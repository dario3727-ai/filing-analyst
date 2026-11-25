-- Milestone 5: Risk Factors compared year over year (decisions 2026-11-25).
-- One row per risk in a comparison of consecutive fiscal years: code finds
-- the change (added / removed / modified / unchanged, word-level diff);
-- Claude only writes `summary` and rates `materiality`.

create table public.risk_changes (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete cascade,
  from_year int not null,
  to_year int not null,
  position int not null check (position >= 0),         -- order on the screen (this year's order)
  kind text not null check (kind in ('added', 'removed', 'modified', 'unchanged')),
  category text,                                        -- e.g. 'Strategic Risks'
  old_title text,
  new_title text,
  old_text text,                                        -- the risk's explanation in from_year
  new_text text,                                        -- ... and in to_year
  old_page int,
  new_page int,
  similarity numeric,                                   -- match score; null for added/removed
  -- Word-level changes: [{ "op": "equal" | "delete" | "insert", "text": "..." }]
  diff jsonb not null default '[]'::jsonb,
  words_added int not null default 0 check (words_added >= 0),
  words_removed int not null default 0 check (words_removed >= 0),
  numbers_only boolean not null default false,          -- only years / references changed
  -- Fingerprint of the change, so a re-run reuses an existing summary.
  change_key text not null,
  summary text,                                         -- Claude's plain-English explanation
  materiality text check (materiality in ('high', 'medium', 'low')),
  model text,                                           -- model that wrote the summary
  created_at timestamptz not null default now(),
  check (from_year < to_year),
  check ((kind = 'added') = (old_title is null)),
  check ((kind = 'removed') = (new_title is null)),
  constraint risk_changes_one_per_position unique (company_id, from_year, to_year, position)
);

create index risk_changes_company_years_idx on public.risk_changes (company_id, to_year);

-- Derived from public filings: read-only for the browser key, like chunks.
alter table public.risk_changes enable row level security;
revoke all on public.risk_changes from anon, authenticated;
grant select on public.risk_changes to anon, authenticated;
create policy "Public read" on public.risk_changes for select to anon, authenticated using (true);
