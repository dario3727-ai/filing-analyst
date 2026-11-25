-- Milestone 3: hybrid search over chunks (decisions 2026-11-24).
--
-- Two ranked lists over one company's passages in a year range:
--   1. semantic: closest embeddings to the question (cosine distance, <=>)
--   2. keyword:  full-text matches on search_text, ranked by ts_rank_cd
-- merged with Reciprocal Rank Fusion: score = 1/(60 + semantic rank)
-- + 1/(60 + keyword rank), a missing rank adding nothing. Ranks, not raw
-- scores, are combined, because cosine and ts_rank use different scales.
--
-- No vector index on purpose: one company's passages for a few years are
-- ~800 rows, so exact distance is fast, and an approximate (HNSW) index
-- combined with the company filter can silently return fewer rows.

create function public.search_chunks(
  query_embedding extensions.vector(1024),
  query_text text,
  p_company_id bigint,
  p_from_year int,
  p_to_year int,
  match_count int default 8,
  p_items text[] default null
)
returns table (
  id bigint,
  filing_id bigint,
  fiscal_year int,
  item text,
  heading text,
  kind text,
  page_start int,
  page_end int,
  content text,
  semantic_rank int,
  keyword_rank int,
  score double precision
)
language sql
stable
security invoker          -- runs with the caller's rights, so the chunks RLS policy applies
set search_path = ''
as $$
  with params as (
    select
      least(greatest(coalesce(match_count, 8), 1), 50) as k,
      -- Questions are prose, so keywords are OR-ed instead of all required:
      -- websearch_to_tsquery joins words with "&"; turn each "&" into "|",
      -- except before a negation ("& !word" from "-word" stays an AND NOT).
      -- Stop words ("why", "did") are dropped by the English configuration.
      regexp_replace(
        pg_catalog.websearch_to_tsquery('english'::regconfig, coalesce(query_text, ''))::text,
        ' & (?!!)', ' | ', 'g'
      ) as tsquery_text
  ),
  filtered as (
    select c.id, c.embedding, c.search_text
    from public.chunks c
    where c.company_id = p_company_id
      and c.fiscal_year between p_from_year and p_to_year
      and (p_items is null or c.item = any (p_items))
  ),
  semantic as (
    select f.id,
           row_number() over (order by f.embedding operator(extensions.<=>) query_embedding, f.id) as rank
    from filtered f
    where f.embedding is not null
    order by rank
    limit (select k * 4 from params)
  ),
  keyword as (
    select f.id,
           row_number() over (
             order by pg_catalog.ts_rank_cd(f.search_text, pg_catalog.to_tsquery('english'::regconfig, p.tsquery_text)) desc, f.id
           ) as rank
    from filtered f, params p
    where p.tsquery_text <> ''
      and f.search_text @@ pg_catalog.to_tsquery('english'::regconfig, p.tsquery_text)
    order by rank
    limit (select k * 4 from params)
  ),
  fused as (
    select coalesce(s.id, kw.id) as id,
           s.rank::int as semantic_rank,
           kw.rank::int as keyword_rank,
           coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + kw.rank), 0) as score
    from semantic s
    full outer join keyword kw on kw.id = s.id
  )
  select c.id, c.filing_id, c.fiscal_year, c.item, c.heading, c.kind, c.page_start, c.page_end, c.content,
         fu.semantic_rank, fu.keyword_rank, fu.score::double precision
  from fused fu
  join public.chunks c on c.id = fu.id
  order by fu.score desc, c.id
  limit (select k from params);
$$;

comment on function public.search_chunks is
  'Hybrid (semantic + keyword) passage search for one company and fiscal-year range, fused with Reciprocal Rank Fusion.';

-- Callable with the browser key; RLS on chunks still limits it to reading.
revoke all on function public.search_chunks from public;
grant execute on function public.search_chunks to anon, authenticated, service_role;
