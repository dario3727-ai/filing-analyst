# Filing Analyst

An AI tool that reads 10-K filings and explains *why* the numbers moved, with every claim cited to the exact passage and checked against the company's reported data.

> Status: planning complete, build starting. See [docs/build-plan.md](docs/build-plan.md) for progress.

## What it does

Pick a public company and Filing Analyst gives you three screens:

1. **Overview.** Key financials and ratios over three fiscal years, plus red flags your code detects automatically (for example, receivables growing much faster than revenue).
2. **Ask the filings.** Plain-English questions like "Why did gross margin fall?" answered from the 10-K text. Every claim links to its source passage, and any number in the answer is checked against the XBRL data.
3. **What changed.** This year's Risk Factors compared with last year's: risks added, removed and reworded, down to word-level changes like "could require" becoming "has required."

Design mockup of all three screens: [SEC Filing Analyst – app mockup](https://claude.ai/artifact/QMDG7sdxADinHYiEh4vSWR) (fictional company, sample data).

## Why it exists

Ratios like EPS and gross margin are free on any finance site, so they aren't the product. The value is in the text: a 10-K runs over 100 pages, and the *why* behind the numbers is buried in management's discussion and the risk factors. Filing Analyst does the first pass in seconds and shows its sources so a person can verify it.

Ratios still matter here, as the supporting layer:
- They check the AI's numbers (the "numbers checked" badge).
- They trigger red flags that point the user to the text that explains them.
- They give the eval suite known-correct answers to grade the AI against.

## Version one scope

- **Sector:** retail only, chosen on purpose. Retailers report similar metrics (revenue, cost of goods sold, inventory), so ratios and red flags behave consistently.
- **Companies:** 5–6 retailers of different sizes and formats, plus one non-retail company used only as a crash test.
- **Filings:** 10-Ks only, the last 3 fiscal years.
- **Out of scope for v1:** 10-Qs and 8-Ks, banks and insurers, loading companies on demand, user accounts.

The code is built so new sectors can be added later through sector profiles (see [CLAUDE.md](CLAUDE.md)), without rewriting the ratio engine.

## How it works

Most of the work happens ahead of time, once per filing. The ingestion worker runs in this order:

1. **SEC submissions API** → `companies` and `filings` rows
2. **SEC companyfacts API (XBRL)** → `financial_facts` → `ratios` → `red_flags`
3. **Download each 10-K** → Supabase Storage → `sections` → `chunks` → Voyage embeddings
4. **Claude compares Risk Factors** year over year → `risk_changes`
5. **Throughout:** every run is logged to `ingestion_runs`

When a user opens a company, the Overview and What changed screens read saved data, with no AI call. The only live AI call is on the Ask screen:

question → embedding → hybrid search (vector + keyword) over `chunks` → top passages + question sent to Claude with citations enabled → answer → numbers checked against XBRL → shown with clickable citations.

Details: [docs/architecture.md](docs/architecture.md) · [docs/database-schema.md](docs/database-schema.md)

## Tech stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Frontend and API routes | Next.js, deployed on Vercel |
| Database, storage, auth | Supabase (Postgres + pgvector) |
| Ingestion worker | Node/TypeScript scripts run locally (`npm run ingest`), later on a schedule via GitHub Actions |
| Embeddings | Voyage AI (`voyage-4`, 1024 dimensions) |
| LLM | Claude API: Haiku for bulk and development work, Sonnet for Q&A and the demo |
| Tests | Vitest |
| CI | GitHub Actions |

## Data sources

All SEC data is free and needs no API key. Every request must send a `User-Agent` header with an app name and contact email, and stay under the SEC's limit of 10 requests per second.

| Source | Endpoint | Used for |
| --- | --- | --- |
| Submissions | `https://data.sec.gov/submissions/CIK##########.json` | Company details and the list of filings |
| Company facts | `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | All XBRL-tagged financial numbers |
| Filing documents | `https://www.sec.gov/Archives/edgar/data/...` | The 10-K HTML itself |

## Running costs

Fixed monthly cost during the build is $0: Supabase, Vercel Hobby, GitHub and Voyage (first 200M tokens) all fit free tiers. The Claude API is pay-per-use; the whole build is estimated at roughly $10–30 with a spend limit set and results cached. Optional later: Supabase Pro to stop the demo from pausing after a week of inactivity, and a custom domain.

## Setup

*Filled in during milestone 0.* Expected shape:

```bash
git clone <repo-url>
cd filing-analyst
npm install
cp .env.example .env.local   # then add your keys
npm run db:migrate
npm run ingest -- --ticker <TICKER>
npm run dev
```

## Known limitations

- Retail only in v1. Ratios for other sectors may show as "not applicable."
- Answers come only from the filings loaded; the app doesn't use news or market prices.
- Not investment advice.

## Project documents

- [CLAUDE.md](CLAUDE.md): standing instructions for Claude Code
- [docs/architecture.md](docs/architecture.md): components and data flow
- [docs/database-schema.md](docs/database-schema.md): tables and columns (draft)
- [docs/build-plan.md](docs/build-plan.md): milestones, tasks and progress
- [docs/decisions.md](docs/decisions.md): decision log
