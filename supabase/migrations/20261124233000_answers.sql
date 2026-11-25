-- Milestone 3: every Q&A result is stored (CLAUDE.md: "Store every AI
-- result"). One row per question answered by Claude, with what it saw,
-- what it said, what it cited and how its numbers checked out.
-- Decisions: docs/decisions.md (2026-11-24).

create table public.answers (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies (id) on delete cascade,
  from_year int not null,
  to_year int not null,
  question text not null check (length(question) between 1 and 1000),
  status text not null
    check (status in ('answered', 'partly_answered', 'not_answered', 'declined', 'truncated')),
  answer text not null,                          -- full text; empty when declined
  -- The answer split where citations start and stop, so the Ask screen can
  -- place a citation icon after each cited part:
  -- [{ "text": "...", "citations": [{ "passageId": 706, "citedText": "..." }] }]
  segments jsonb not null default '[]'::jsonb,
  -- Distinct cited passages with their text. Text is copied because
  -- re-parsing a filing replaces its passages (and their ids).
  citations jsonb not null default '[]'::jsonb,
  -- Every passage Claude was given, in order, with its search ranks: tells
  -- "search missed it" apart from "Claude missed it" when reviewing.
  passages_sent jsonb not null default '[]'::jsonb,
  -- Result of the number check: counts plus each figure's status.
  numbers_checked jsonb not null default '{}'::jsonb,
  model text not null,
  stop_reason text,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  latency_ms int check (latency_ms >= 0),
  created_at timestamptz not null default now(),
  check (from_year <= to_year)
);

create index answers_company_created_idx on public.answers (company_id, created_at desc);

-- Private, like ingestion_runs: questions people type are not public data.
-- Only server code with the secret key reads and writes this table.
alter table public.answers enable row level security;
revoke all on public.answers from anon, authenticated;
