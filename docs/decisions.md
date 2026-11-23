# Decision log

Each entry: date, decision, why, alternatives considered. Useful for interviews: "why did you build it this way?"

## 2026-11-23: Build an SEC filing analyst as the portfolio project
- **Why:** real, free public data; builds AI engineering skills employers ask for (retrieval, citations, extraction, evals); closes my gap in reading financial statements.
- **Alternatives:** portfolio risk dashboard (easier, but AI would be a thin layer); cash-flow tool on Off the Wall data (no real data yet).

## 2026-11-23: Value comes from the text, not the ratios
- **Why:** ratios and EPS are free elsewhere. The product is cited answers about *why*, and detecting changes between filings. Ratios check the AI, trigger red flags and feed evals.

## 2026-11-23: Retail only for version one
- **Why:** consistent metrics across companies, meaningful red flags, faster to a working demo, manageable evals.
- **Guardrails:** sector profiles from day one; missing data → "not applicable"; 5–6 retailers for parsing variety; one non-retail company as a crash test.
- **Alternatives:** mixed sectors from the start (more general, slower); 3 retailers (too little variety).

## 2026-11-23: Next.js on Vercel for the frontend and API routes
- **Why:** one project for UI and server endpoints; free Hobby hosting for a personal project.
- **Alternatives:** Vite + React with Supabase Edge Functions.

## 2026-11-23: Ingestion runs as a Node script, not a serverless function
- **Why:** large downloads and embedding can exceed serverless time limits.

## 2026-11-23: Numbers from XBRL; Claude for text only
- **Why:** accuracy. The AI never produces a financial figure; code reads it from tagged data.

## 2026-11-23: Voyage for embeddings, pgvector in Supabase for search
- **Why:** Anthropic doesn't offer an embedding model; Voyage's free tier covers v1; pgvector avoids a separate vector database.

## 2026-11-23: Public repo from day one; Claude Code teaches as it builds
- **Why:** employers can see progress and commit history; I need to understand and explain every part.

## 2026-11-23: Tailwind CSS for styling
- **Why:** the default with Next.js; quick to build the mockup's three screens in milestone 4; free.
- **Alternatives:** plain CSS / CSS Modules (nothing extra to learn, but slower to build the UI).

## 2026-11-23: Develop inside WSL (Linux), not directly on Windows
- **Why:** Windows Smart App Control blocks an unsigned compiled file that Vitest needs (Rolldown's native binding), so tests couldn't run on Windows. WSL runs the same OS as GitHub Actions and Vercel, so local results match CI, and Smart App Control stays on.
- **Alternatives:** a local WebAssembly patch (works, but must be re-applied after every `npm install` and can't go in `package.json` because it breaks clean installs); turning off Smart App Control (lowers the PC's protection).

## 2026-11-23: Supabase CLI for migrations; pgvector and the storage bucket are migrations too
- **Why:** `npm run db:migrate` (`supabase db push --remote`) applies only migrations that haven't run and records them in the database, so the schema is reproducible and never edited by hand. Creating the `raw-filings` bucket and enabling pgvector in SQL keeps the whole setup in Git.
- **Details:** bucket is private with no access policies (service-role key only), 50 MB per file (free-plan maximum), HTML only. pgvector lives in the `extensions` schema, as Supabase recommends. Project region East US, close to Vercel's default region.
- **Note:** Supabase CLI 3.x targets a local Docker database by default; commands for the real project need `--remote`.
- **Alternatives:** pasting SQL into the dashboard editor (no dependency, but nothing tracks what ran).
