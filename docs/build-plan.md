# Build plan

About 8 weeks at 15–25 hours a week. That's an estimate: parsing (milestone 2) is the most likely place to run long. Every milestone ends with something working and committed.

## Milestone 0: setup (week 1)
- [x] Create the public GitHub repo and push these starter files
- [x] Scaffold Next.js with TypeScript (strict), ESLint and Vitest
- [x] Create the second Supabase project; enable pgvector; create the `raw-filings` bucket
- [x] Add `.env.local` from `.env.example`; set a monthly spend limit in the Claude Console
- [x] GitHub Actions workflow that runs lint and tests on every push
- [x] Short TypeScript primer for me: types, interfaces, async/await, modules
- **Done when:** `npm test` passes locally and in CI, and the app runs at localhost.

## Milestone 1: the numbers pipeline (weeks 1–2)
- [x] Choose the test set (see below) and record it in `docs/decisions.md`
- [x] SEC client: User-Agent, rate limiter (≤8 req/s), retries, tests
- [x] Migrations for `companies`, `filings`, `financial_facts`, `ratios`, `red_flags`, `ingestion_runs`
- [x] Submissions → `companies` and `filings`
- [x] Company facts → `financial_facts`, with deduplication verified on real data
- [x] Retail sector profile: metrics, formulas, XBRL tag fallbacks
- [x] Ratio engine with "not applicable" handling, plus tests
  - [x] Stock-split adjustment for per-share and share-count values (Walmart 3-for-1 in 2024, Kroger 2-for-1 in 2015; see decisions 2026-11-24)
- [x] Red-flag rules with thresholds documented, plus tests
- [x] `npm run ingest -- --ticker <TICKER> --from <YEAR> --to <YEAR>` ties it together and logs to `ingestion_runs` (all XBRL years are stored; the window limits which 10-Ks are loaded)
- **Done when:** all test-set companies load, the crash-test company runs without errors, and ratios match a manual spot check for one retailer.
- **Showable:** a tested tool that pulls any company's financials and calculates its ratios.
- **Milestone 1 completed 2026-11-24:** all 7 companies load with `npm run ingest:test-set` (21 SEC requests); Adobe runs without errors; Target fiscal 2024 ratios match an independent SQL calculation and the 10-K.

## Milestone 2: filing text (weeks 3–4)
- [x] Download 10-Ks to Storage, skipping files already saved
- [x] Save a few real filings as test fixtures
- [x] Section parser: find Items 1, 1A, 7, 7A, 8; skip the table of contents
- [x] Chunker: passages of a few hundred tokens with page and section metadata
- [x] Migrations for `sections` and `chunks`
- [x] Parser tests for every test-set company
- [x] Coverage report: share of filings where all key sections were found
- **Done when:** coverage is 100% for the retail test set, or each failure is explained.
- **Milestone 2 completed 2026-11-24:** `npm run coverage` shows all five sections in 21 of 21 parsed 10-Ks (fiscal 2023–2025, all seven companies, crash test included): 105 sections, 4,874 passages.

## Milestone 2.5: bare-bones frontend (added 2026-11-24)
Unstyled on purpose: shows which features exist and which numbers clutter or are missing, before design work. See decisions 2026-11-24.
- [x] Landing page: "Filer", company search (preloaded companies only), year-range slider over downloaded years with no gaps
- [x] Results page: company details, key financials, ratios with notes and "not applicable" reasons, red flags with evidence, filings and sections, placeholders for Ask and What changed
- **Done when:** searching any test-set company shows its stored data for the chosen years.
- **Milestone 2.5 completed 2026-11-24:** checked in the browser for Walmart, Kroger (missing inventory, notes) and Adobe (crash test); unknown tickers show a 404.

## Milestone 3: search and Q&A (week 5)
- [x] Voyage embeddings for all chunks, in batches (4,874 passages in 21 filings; decisions 2026-11-24)
- [x] Hybrid search as a Postgres function (vector + full-text), filtered by company (`search_chunks`; try it with `npm run search`)
- [x] Q&A function: Claude with citations over the top passages (`answerQuestion`; try it with `npm run ask`)
- [x] Number check against `financial_facts` (`checkFigures`; shown by `npm run ask`)
- [x] `answers` table and logging (private; `npm run ask` saves every answer)
- [x] API route `/api/ask` (validation, per-visitor and daily limits, reuse of identical answers)
- **Done when:** 10 hand-written questions return correct, cited answers.
- **Milestone 3 completed 2026-11-24:** `npm run check:questions` gives 10 of 10 correct, cited answers on Sonnet (report in `docs/checks/milestone-3-questions.md`), after fixing running headers in the parser and four retrieval issues the check exposed (see decisions).

## Milestone 4: frontend (week 6)
Bare-bones look kept on purpose (decisions 2026-11-24): the milestone 2.5 pages are the design.
- [x] Company search and year-range picker (built in milestone 2.5)
- [x] Overview: key metrics, ratios with notes, red flags, filings (built in milestone 2.5; no separate styling pass)
- [x] Ask: question box, answer with a book icon on each citation that opens the cited 10-K section in a collapsible right-side panel, scrolled to and highlighting the passage (decisions 2026-11-24; checked on desktop and phone width)
- [x] What changed: placeholder until milestone 5 fills it
- [x] Layout works on a phone (checked at 375 px: no sideways page scroll; the filings and XBRL-facts tables scroll inside their own box)
- ~~Design pass from the mockup~~ dropped 2026-11-24 (the user prefers the bare-bones look)
- **Done when:** the three screens work with real data in the bare-bones layout, and every page is usable at phone width.
- **Milestone 4 completed 2026-11-24:** search and year picker, Overview, Ask with the citation side panel, and the What changed placeholder all work with real data; checked on desktop and at phone width.

## Milestone 5: risk changes and evals (week 7)
- [x] Risk Factors comparison with Claude (Batch API) → `risk_changes` (`npm run risks`: 14 year pairs, 347 rows, 260 Haiku summaries)
- [x] What changed screen
- [x] Eval set: 50–100 questions, many generated from XBRL, some the filing can't answer (58 cases, `eval/qa/cases.md`, approved 2026-11-25)
- [x] `npm run eval`: scores number accuracy, citation support and admitting unknowns; writes results files and a report under `.claude/hillclimb/qa/` (the planned `eval_results` table was dropped, decisions 2026-11-25)
- [x] Compare Haiku and Sonnet scores (Sonnet 79.3%, Haiku 75.9%: within the noise; Haiku 15× cheaper)
- **Done when:** eval scores are recorded and in the README.
- **Milestone 5 completed 2026-11-25:** What changed live for all seven companies (14 year pairs); eval on 58 questions: Sonnet 79.3%, Haiku 75.9%, recorded in the README.

## Milestone 6: ship (week 8)
- [ ] Deploy to Vercel; keep the Supabase project from pausing
- [ ] README: setup steps, architecture diagram, eval results, limitations
- [ ] 2-minute demo video and screenshots
- [ ] Decisions log reviewed for interview prep
- **Done when:** a stranger can open the live link and use all three screens.

## Test set (confirmed 2026-11-24)

Six retailers that differ in size and format, plus one non-retail crash test. Details and reasons in `docs/decisions.md`.

| Slot | Company | Ticker | CIK | Fiscal year end |
| --- | --- | --- | --- | --- |
| Big box / general merchandise | Walmart | WMT | 0000104169 | Jan 31 (fixed date) |
| Big box / general merchandise | Target | TGT | 0000027419 | Saturday nearest Jan 31 (52/53 weeks) |
| Warehouse club | Costco | COST | 0000909832 | Sunday nearest Aug 31 (52/53 weeks) |
| Grocery | Kroger | KR | 0000056873 | Saturday nearest Jan 31 (52/53 weeks) |
| Specialty apparel | Gap Inc. | GAP | 0000039911 | Saturday nearest Jan 31 (52/53 weeks) |
| Value / smaller retailer | Five Below | FIVE | 0001177609 | Saturday nearest Jan 31 (52/53 weeks) |
| Crash test (non-retail) | Adobe | ADBE | 0000796343 | Friday nearest Nov 30 (52/53 weeks) |
