# CLAUDE.md

Standing instructions for Claude Code on the Filing Analyst project. Read this, then `README.md` and `docs/build-plan.md`, at the start of every session.

## About me

- Recent college graduate with a finance degree. Strong at math; less confident reading financial statements, so explain accounting terms briefly when they come up.
- Before this project I built a booking system with React (via an AI app builder), Supabase, about 15 n8n workflows with JavaScript code nodes, and Stripe Terminal in test mode.
- New to TypeScript, Next.js, Git workflows and automated testing. I know JavaScript from n8n code nodes.
- Goal: a portfolio project that proves to employers I can build a reliable AI system on real financial data. I must be able to explain every part of it in an interview.
- Time: about 15–25 hours a week.

## How to work with me: teach as you build

1. **Small steps.** One focused change at a time. Before starting, say in two or three sentences what you're about to do and why.
2. **Explain what you write.** After creating or changing a file, explain what it does and any new concept in plain language. Where it helps, relate it to n8n (a webhook node is an API route, an HTTP Request node is `fetch()`, a code node is a TypeScript function).
3. **Tests with the code.** Write tests alongside logic, not afterwards. Run them and show me the result.
4. **Check my understanding.** At the end of each task, ask me one or two short questions about what we built before moving to the next task.
5. **Ask before big decisions.** New dependencies, schema changes, changes to the architecture or anything that costs money: explain the options and let me choose.
6. **Keep the build plan current.** Tick tasks in `docs/build-plan.md` as they're done. Record meaningful choices in `docs/decisions.md` (date, decision, why, alternatives).
7. **Commit often.** Small commits with clear messages, after tests pass. Tell me what each commit contains.

## Hard rules

### Data and accuracy
- **Numbers come from XBRL, never from the AI.** Financial figures are read from `financial_facts`. Claude is used for text only: answering from passages, extracting text facts, comparing filings.
- **Every AI answer must be grounded.** Q&A uses the Claude API's citations feature over retrieved passages. If the passages don't answer the question, the answer says so.
- **Citations and structured outputs are separate calls.** The Claude API doesn't allow both in one request, so Q&A (citations) and extraction (structured JSON) stay in different functions with different prompts.
- **Missing data never crashes and never guesses.** If an XBRL tag isn't found, the metric is stored as "not applicable" with the reason.

### Sector profiles
- Metric definitions live in one config, organized by sector (for example `src/metrics/profiles/retail.ts`). Each metric lists its formula and an ordered list of XBRL tags to try.
- The ratio engine reads the profile; it never hardcodes retail assumptions such as "inventory always exists."
- v1 fills in only the retail profile. The non-retail crash-test company must run through the whole pipeline without errors, even if most of its ratios are "not applicable."

### SEC access
- Every request sends `User-Agent` from the `SEC_USER_AGENT` environment variable (app name + contact email).
- Rate-limit all SEC requests to at most 8 per second (under the SEC's limit of 10), with retry and backoff on 429 or 5xx responses.
- Cache raw downloads in Supabase Storage and never download the same filing twice.

### Costs
- Use Claude Haiku during development and for bulk jobs; use Sonnet for Q&A and final eval runs. Check current model names in the Anthropic docs before wiring them up.
- Use the Batch API for bulk jobs that don't need an instant answer, such as processing all Risk Factors sections.
- Store every AI result in the database and never re-run Claude on a filing that's already processed.
- Never write code that loops API calls without a hard cap.

### Secrets
- Keys live only in `.env.local`, which is gitignored. Keep `.env.example` updated with variable names and no values.
- The Supabase secret key (`SUPABASE_SECRET_KEY`, formerly the service-role key) is used only in server code and scripts, never in browser code or a `NEXT_PUBLIC_` variable.
- Before every commit, check that no key or `.env` file is staged.

## Project conventions

- TypeScript in strict mode. No `any` unless there's a written reason.
- Database changes only through SQL migration files in `supabase/migrations/`. Never edit the database by hand.
- Ingestion scripts live in `scripts/` and run with `npm run ingest -- --ticker <TICKER> --from <YEAR> --to <YEAR>`. Every run writes to `ingestion_runs`.
- Tests next to the code or in `tests/`, using Vitest. Parser tests use saved copies of real filings as fixtures.
- Pure functions for calculations (ratios, red-flag rules, chunking) so they're easy to test.

## Retail-specific gotchas

- Many retailers have fiscal years ending in late January or early February, and some years have 53 weeks. Label periods by fiscal year, and handle 53-week years when comparing year over year.
- Companies use different XBRL tags for the same concept (revenue has several). Profiles list fallbacks in order.
- The SEC's companyfacts data can repeat the same value when it appears in several filings (a later 10-K restates the prior year). Deduplicate on company, concept and period. Verify this against real data in milestone 1.

## Reference

- Design mockup: https://claude.ai/artifact/QMDG7sdxADinHYiEh4vSWR
- Architecture: `docs/architecture.md`
- Schema draft: `docs/database-schema.md`
- Build plan and current milestone: `docs/build-plan.md`
- SEC API docs: https://www.sec.gov/edgar/sec-api-documentation
- Claude citations: https://platform.claude.com/docs/en/build-with-claude/citations
- Voyage embeddings: https://docs.voyageai.com/docs/pricing
