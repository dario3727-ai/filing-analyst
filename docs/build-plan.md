# Build plan

About 8 weeks at 15–25 hours a week. That's an estimate: parsing (milestone 2) is the most likely place to run long. Every milestone ends with something working and committed.

## Milestone 0: setup (week 1)
- [ ] Create the public GitHub repo and push these starter files
- [ ] Scaffold Next.js with TypeScript (strict), ESLint and Vitest
- [ ] Create the second Supabase project; enable pgvector; create the `raw-filings` bucket
- [ ] Add `.env.local` from `.env.example`; set a monthly spend limit in the Claude Console
- [ ] GitHub Actions workflow that runs lint and tests on every push
- [ ] Short TypeScript primer for me: types, interfaces, async/await, modules
- **Done when:** `npm test` passes locally and in CI, and the app runs at localhost.

## Milestone 1: the numbers pipeline (weeks 1–2)
- [ ] Choose the test set (see below) and record it in `docs/decisions.md`
- [ ] SEC client: User-Agent, rate limiter (≤8 req/s), retries, tests
- [ ] Migrations for `companies`, `filings`, `financial_facts`, `ratios`, `red_flags`, `ingestion_runs`
- [ ] Submissions → `companies` and `filings`
- [ ] Company facts → `financial_facts`, with deduplication verified on real data
- [ ] Retail sector profile: metrics, formulas, XBRL tag fallbacks
- [ ] Ratio engine with "not applicable" handling, plus tests
- [ ] Red-flag rules with thresholds documented, plus tests
- [ ] `npm run ingest -- --ticker <TICKER>` ties it together and logs to `ingestion_runs`
- **Done when:** all test-set companies load, the crash-test company runs without errors, and ratios match a manual spot check for one retailer.
- **Showable:** a tested tool that pulls any company's financials and calculates its ratios.

## Milestone 2: filing text (weeks 3–4)
- [ ] Download 10-Ks to Storage, skipping files already saved
- [ ] Save a few real filings as test fixtures
- [ ] Section parser: find Items 1, 1A, 7, 7A, 8; skip the table of contents
- [ ] Chunker: passages of a few hundred tokens with page and section metadata
- [ ] Migrations for `sections` and `chunks`
- [ ] Parser tests for every test-set company
- [ ] Coverage report: share of filings where all key sections were found
- **Done when:** coverage is 100% for the retail test set, or each failure is explained.

## Milestone 3: search and Q&A (week 5)
- [ ] Voyage embeddings for all chunks, in batches
- [ ] Hybrid search as a Postgres function (vector + full-text), filtered by company
- [ ] Q&A function: Claude with citations over the top passages
- [ ] Number check against `financial_facts`
- [ ] `answers` table and logging
- [ ] API route `/api/ask`
- **Done when:** 10 hand-written questions return correct, cited answers.

## Milestone 4: frontend (week 6)
- [ ] Company list and search (preloaded companies only)
- [ ] Overview: key metrics, 3-year revenue chart, ratio table, red flags
- [ ] Ask: question box, answer with numbered citations, source panel
- [ ] What changed: placeholder until milestone 5 fills it
- [ ] Layout works on a phone
- **Done when:** the three screens match the mockup's structure using real data.

## Milestone 5: risk changes and evals (week 7)
- [ ] Risk Factors comparison with Claude (Batch API) → `risk_changes`
- [ ] What changed screen
- [ ] Eval set: 50–100 questions, many generated from XBRL, some the filing can't answer
- [ ] `npm run eval`: scores number accuracy, citation support and admitting unknowns; writes `eval_results`
- [ ] Compare Haiku and Sonnet scores
- **Done when:** eval scores are recorded and in the README.

## Milestone 6: ship (week 8)
- [ ] Deploy to Vercel; keep the Supabase project from pausing
- [ ] README: setup steps, architecture diagram, eval results, limitations
- [ ] 2-minute demo video and screenshots
- [ ] Decisions log reviewed for interview prep
- **Done when:** a stranger can open the live link and use all three screens.

## Test set (confirm in milestone 1)

Pick 5–6 retailers that differ in size and format, so filing formats vary:

| Slot | Candidates |
| --- | --- |
| Big box / general merchandise | Walmart, Target |
| Warehouse club (non-January year end) | Costco |
| Grocery | Kroger |
| Specialty apparel | Gap Inc. |
| Value / smaller retailer | Five Below |
| Crash test (non-retail) | A large software company |

Check each company's fiscal year end and recent filing history before committing to it.
