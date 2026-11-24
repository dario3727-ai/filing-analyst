-- Milestone 2: parsed 10-K sections and the passages (chunks) cut from them.
-- Decisions: docs/decisions.md (2026-11-24, parser and passages).

-- ---------------------------------------------------------------------------
-- sections: one row per target item found in a filing.
-- ---------------------------------------------------------------------------
create table public.sections (
  id bigint generated always as identity primary key,
  filing_id bigint not null references public.filings (id) on delete cascade,
  item text not null check (item in ('1', '1A', '7', '7A', '8')),
  title text not null,
  page_start int not null check (page_start >= 1),
  page_end int not null,
  word_count int not null check (word_count >= 0),
  created_at timestamptz not null default now(),
  check (page_end >= page_start),
  constraint sections_one_per_item unique (filing_id, item)
);

-- ---------------------------------------------------------------------------
-- chunks: ~300-token passages for search and citations.
-- company_id, fiscal_year and item are copied from the filing and section so
-- search can filter on one table ("Walmart, 2023–2025, Risk Factors").
-- Re-parsing a filing replaces its sections, and with them its chunks.
-- ---------------------------------------------------------------------------
create table public.chunks (
  id bigint generated always as identity primary key,
  section_id bigint not null references public.sections (id) on delete cascade,
  filing_id bigint not null references public.filings (id) on delete cascade,
  company_id bigint not null references public.companies (id) on delete cascade,
  fiscal_year int not null,
  item text not null,
  chunk_index int not null check (chunk_index >= 0),
  heading text,                                              -- nearest subheading, if any
  kind text not null check (kind in ('text', 'table')),
  page_start int not null check (page_start >= 1),
  page_end int not null,
  content text not null check (length(content) > 0),
  word_count int not null check (word_count > 0),
  token_count int not null check (token_count > 0),          -- estimate (≈ 1.33 per word)
  -- Filled in milestone 3 (Voyage, 1024 dimensions). The vector index is
  -- added then, once the distance measure is chosen.
  embedding extensions.vector(1024),
  embedding_model text,
  -- Keyword search with English stemming: "prices" matches "price", and
  -- "competitive" matches "competition" (both stem to "competit"); note
  -- "competitors" stems to "competitor", a different word.
  search_text tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(heading, '') || ' ' || content)
  ) stored,
  created_at timestamptz not null default now(),
  check (page_end >= page_start),
  -- An embedding always records which model produced it.
  check ((embedding is null) = (embedding_model is null)),
  constraint chunks_one_per_index unique (section_id, chunk_index)
);

create index chunks_company_year_idx on public.chunks (company_id, fiscal_year);
create index chunks_filing_idx on public.chunks (filing_id);
create index chunks_search_idx on public.chunks using gin (search_text);

-- ---------------------------------------------------------------------------
-- Access: public 10-K text, read-only for the browser key; only the secret
-- key writes (same pattern as the numbers tables).
-- ---------------------------------------------------------------------------
alter table public.sections enable row level security;
alter table public.chunks enable row level security;

revoke all on public.sections, public.chunks from anon, authenticated;
grant select on public.sections, public.chunks to anon, authenticated;

create policy "Public read" on public.sections for select to anon, authenticated using (true);
create policy "Public read" on public.chunks for select to anon, authenticated using (true);
