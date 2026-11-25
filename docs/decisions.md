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

## 2026-11-24: Test set: Walmart, Target, Costco, Kroger, Gap, Five Below; Adobe as crash test
- **Why:** six retailers of different formats and sizes, checked against SEC submissions and XBRL data (each filed an inline-XBRL 10-K in every one of the last 3–4 years checked). Each adds a different case for the parser and the tag fallbacks:
  - **Walmart:** fixed Jan 31 year end (no 53-week years); COGS tagged `CostOfRevenue`.
  - **Target:** 52/53-week year (FY ending 2024-02-03 had 53 weeks); COGS tagged `CostOfGoodsAndServicesSold`.
  - **Costco:** August year end; stopped using the `Revenues` tag after FY2025, so revenue needs a fallback.
  - **Kroger:** none of the standard COGS tags in recent 10-Ks and `InventoryNet` only outside 10-Ks; likely company-specific tags. The hardest case; gross margin may honestly be "not applicable."
  - **Gap:** no `InventoryNet` tag; document names changed from `gps-` to `gap-` after the 2024 ticker change.
  - **Five Below:** smaller company with standard tags: the clean baseline.
- **Crash test:** Adobe. Software, no inventory or standard COGS tags, so inventory ratios must come out "not applicable"; November/December year end with a 53-week FY2023.
- **Found along the way:** companies label fiscal years differently (Walmart calls the year ending Jan 2026 "fiscal 2026," Target "fiscal 2025"). One labeling rule is needed; decide it in the company facts task.
- **Alternatives:** Microsoft as crash test (rejected: reports inventory and COGS, so retail ratios would calculate); Salesforce (works, but its January year end adds nothing the retailers don't cover).

## 2026-11-24: Configurable fiscal-year window instead of "last 3 years"
- **Decision:** `npm run ingest -- --ticker <T> --from <YEAR> --to <YEAR>` loads 10-K text for that window; all XBRL annual facts are stored for every available year regardless; the frontend gets a year-range picker limited to loaded years. Short window while developing (2 years minimum, so growth rates, red flags and What changed can be tested); longer for the demo.
- **Why:** lets users compare any span (e.g. 2020–2023) within what's loaded. XBRL is one request per company whatever the span, so storing every year costs almost nothing. Text (download, parsing, embeddings, Claude comparisons) grows per year, so the window controls it.
- **Fits the free tier (measured 2026-11-24 for the 7 test-set companies):**
  - XBRL, all years (2009–2026): ~32,000 unique annual facts in total → roughly 13 MB of the 500 MB database.
  - Raw 10-K HTML: 1.4–4.8 MB each (Kroger largest), average 2.3 MB → ~115 MB of 1 GB storage for 7 years of all 7 companies.
  - Chunks + embeddings (estimate, to be measured in milestones 2–3): ~3–4 MB per 10-K → ~75 MB for 3 years, ~180 MB for 7 years. Total database for a 7-year window ≈ 200 MB.
  - If space gets tight: store embeddings as `halfvec` (half the size), or skip Item 8 tables (already planned).
- **Alternatives:** fixed last 3 years (simpler, but no user choice); loading years on demand (out of scope for v1).

## 2026-11-24: Fiscal year = the calendar year most of its months fall in
- **Decision:** a fiscal year ending 2026-01-31 is labeled 2025; one ending 2026-08-30 is 2026; one ending 2025-11-28 is 2025. Derived from period dates; the UI also shows "FY ending Jan 31, 2026."
- **Why:** matches 6 of the 7 test-set companies' own labels (all but Walmart) and the SEC's calendar-year "frames," and gives the same period the same label across companies, so a year range compares like with like.
- **Verified:** the SEC's `fy` field can't be used. Walmart's 10-K filed 2026-03-13 reports revenue for periods ending Jan 2024, 2025 and 2026, all with `fy=2026`; the period ending 2024-01-31 appears in three filings (`fy` 2024, 2025, 2026).
- **Alternatives:** the year the period ends (matches Walmart only, and mislabels a year ending in early January).

## 2026-11-24: Keep the latest reported value when filings repeat a number
- **Decision:** `financial_facts` holds one row per company, concept, unit and period; when several 10-Ks report it, the most recently filed value wins, with its accession number and filing date.
- **Why:** later 10-Ks restate (correct) earlier numbers; using the latest puts every year on the same basis, as a 10-K's own comparison tables do.
- **Alternatives:** as originally reported (shows what investors saw at the time, but restated years can be on different bases).

## 2026-11-24: Row-level security on every table; public data is read-only for the browser key
- **Decision:** RLS on all tables. `companies`, `filings`, `financial_facts`, `ratios`, `red_flags` get a SELECT-only policy and grant for `anon`/`authenticated`; `ingestion_runs` gets none. Only the secret key (server and scripts) writes.
- **Why:** Supabase exposes tables over a REST API to anyone holding the publishable key, which ships to the browser. The data is public SEC data, so reading is fine; writing must never be. Verified over REST: reads return 200; insert, delete and reading `ingestion_runs` return "permission denied."
- **Alternatives:** no public access, with every read going through Next.js server routes (tighter, more code for public data).

## 2026-11-24: supabase-js behind a small store interface
- **Decision:** `@supabase/supabase-js` for database access. Ingest code talks to an `IngestStore` interface (start/update run, upsert company, upsert filings); `supabase-store.ts` implements it with the secret key, and tests use an in-memory fake.
- **Why:** official client, same REST API and RLS we tested, reused by the frontend later. The interface keeps pipeline logic testable without a database, like the fake clock and fake fetch.
- **Details:** upserts key on `cik` and `accession_no`, and never send `status` or `storage_path`, so re-running submissions can't undo later steps. Each run is logged in `ingestion_runs`, failed runs included.
- **Alternatives:** hand-written fetch calls to the REST API (no dependency, but rebuilding what the client does).

## 2026-11-24: Which company facts are stored, and de-duplication verified on real data
- **Kept:** facts from 10-K and 10-K/A; durations of 350–380 days (52/53-week years); point-in-time values only at a fiscal year end (dates taken from the annual durations). Dropped: 10-Q facts, quarterly values inside 10-Ks, cover-page dates such as shares outstanding in March.
- **De-duplication (real data, all 7 companies, every year since ~2007):** about half of annual 10-K facts are repeats. Walmart: 8,514 annual facts reported → 4,085 unique; 2,850 periods reported more than once. Totals: 28,252 unique facts stored, 10 MB. Re-running a company leaves the row count unchanged, and the database has 0 duplicate periods.
- **Restatements:** 47–387 periods per company were later reported with a different value: stock splits (Kroger fiscal 2013 diluted EPS $2.90 → $1.45), reclassifications (Target fiscal 2013 cost of goods sold −2.2%, Gap receivables −10.6%) and rounding (Adobe, ≤0.02%). The latest value is kept, per the decision above.

## 2026-11-24: Ratio engine rules: splits, 53-week years, crash test
- **Stock splits (resolves the open issue below):** a split is detected when diluted shares change by at least ×1.4 (or ÷1.4) and land within 6% of a clean factor (1.5, 2, 3, 4, 5, 10, 20 or the reverse), with total assets moving less than ×1.5 (otherwise it may be a merger). The prior year's per-share value is divided by the factor, with a note; an unclear jump makes per-share comparisons "not applicable." Result on real data: Walmart fiscal 2021 EPS growth +2.3% (×2.96 → 3-for-1), Kroger fiscal 2013 +4.7% (×1.94 → 2-for-1), instead of −66% and −48%.
- **53-week years:** values as reported, with a note only where the extra week distorts the metric: growth (a 53-week year compared with a 52-week one) and metrics setting a year's flow against balances (turnover, days, return on assets). Margins compare same-year flows, so they get no note.
- **Crash test:** companies without their own profile get the retail profile, labeled "Retail metrics applied to a non-retail company (crash test)" on every result. Adobe: 228 results, all labeled; inventory metrics not applicable.
- **Storage:** every metric for every fiscal year with any data (about 228 rows per company), with the values, tags and notes used in `ratios.inputs`.
- **Older-year fallbacks:** added `SalesRevenueGoodsNet` (Kroger before 2016) and `CostOfMerchandiseSalesBuyingAndOccupancyCosts` (Gap 2010–2016), each equal to the newer tag in an overlap year. Not added: pre-tax income as a stand-in for Target's missing operating-income years (a different number).
- **Spot check (Target fiscal 2024):** all 11 computed ratios match an independent SQL calculation from the raw facts, and the raw inputs (net sales $106,566M, cost of sales $76,502M, operating income $5,566M, net earnings $4,091M, inventory $12,740M / $11,886M, diluted EPS $8.86 / $8.94) were checked by hand against the 10-K (tgt-20250201.htm) on 2026-11-24 and match.
- **Alternatives:** always "not applicable" across splits; scaling 53-week years to 52 weeks (over-corrects, since the extra week is usually slow); all "not applicable" for the crash test.

## 2026-11-24: Retail red-flag rules and thresholds
Calibrated on the six retailers, fiscal 2015–2025 (66 company-years); about a quarter of company-years get at least one flag.

| Rule | Threshold | Fired | Why it matters |
| --- | --- | --- | --- |
| `inventory_outpaces_sales` | inventory growth − revenue growth > 10 points | 6 | Unsold stock piling up usually means markdowns next year. Target fiscal 2021 (+30.5% vs +13.3%) fired a year before its fiscal 2022 margin drop; Walmart fiscal 2021 too. |
| `gross_margin_drop` | gross margin down > 2 points year over year | 5 | Markdowns, cost pressure or mix shift (Target 2022: 29.3% → 24.6%). |
| `operating_margin_drop` | operating margin down > 2 points year over year | 8 | Costs outgrowing sales (Five Below 2022 and 2024, Gap 2019). |
| `negative_free_cash_flow` | free-cash-flow margin < 0 | 4 | Store and equipment spending not covered by operating cash flow (Target 2022, Gap 2020 and 2022). |
| `weak_cash_conversion` | operating cash flow ÷ net income < 1.0 | 0 | Retailers sit well above 1 because depreciation is non-cash, so falling below is unusual. Kept as a rare-event check. |

- **Left out:** receivables growing faster than revenue. Most retail sales are paid at the till, so receivables are small and their growth noisy (Kroger fiscal 2015 +36 points); judged not a meaningful warning for retail. The receivables-vs-revenue *metric* stays, without a flag.
- **Behavior:** a rule needing a missing or not-applicable value doesn't fire. Each flag stores a plain-English detail, the numbers that triggered it, and the notes of the metrics used (53-week years, crash-test label). A company's flags are replaced on every run so a flag that stops firing disappears.
- **Verified:** stored counts match the calibration exactly; re-running a company leaves its count unchanged.

## 2026-11-24: 10-K documents saved once, as raw bytes
- **Decision:** ingest step 5 saves each 10-K in the window to `raw-filings/{TICKER}/{fiscal_year}.htm`. Skip if `filings.storage_path` is set; if the file is already in Storage (a run that crashed before updating the database), record it without downloading; otherwise download through the SEC client and upload with overwrite turned off. Files over the bucket's 50 MB limit are refused before upload.
- **Why raw bytes:** the file is stored exactly as the SEC sent it. Older filings aren't always UTF-8, and decoding at download time can silently garble characters; the parser decides the encoding.
- **Verified:** first run downloaded 21 10-Ks (47 MB); a second run downloaded none and made half the SEC requests (21 vs 42).
- **Alternatives:** storing decoded text (smaller code path, but loses the original); re-downloading when unsure (breaks the "never twice" rule).

## 2026-11-24: Parser fixtures: latest 10-K for all seven companies, gzip-compressed
- **Decision:** `npm run fixtures:save -- --write` copies each company's latest stored 10-K from Supabase Storage (not the SEC) to `tests/fixtures/filings/{ticker}-{fiscal_year}.htm.gz`. 1.3 MB in total instead of 16.1 MB raw; byte-identical once unzipped. `.gitattributes` marks `*.gz` binary.
- **What the fixtures show (input for the section parser):**
  - All seven are pure ASCII: special characters are HTML entities, so encoding isn't a problem for current filings.
  - "Item 1A" appears 4–15 times per filing (table of contents in the first 1–6% of the text, the real heading, cross-references in the text); matching the phrase isn't enough.
  - 5 to 2,577 hidden elements (`display:none`, mostly hidden XBRL facts) must be dropped.
  - 68–105 page breaks per filing, as CSS `page-break-before/after: always`; Kroger has no `<hr>` with them, so page numbering must use the CSS.
  - 31k–57k words of visible text per filing.
- **Alternatives:** raw HTML in the repo (16.1 MB working copy, readable on GitHub); downloading fixtures during tests (needs secrets in CI and the network).

## 2026-11-24: Section parser: htmlparser2, "last heading wins"
- **Library:** `htmlparser2` (v12): fast, forgiving with messy HTML, four small dependencies, and gives a plain tree we walk ourselves. Alternatives: cheerio (jQuery-style API, more dependencies we wouldn't use), node-html-parser (less strict about HTML rules).
- **Stage 1, blocks:** decode (strict UTF-8, else Windows-1252); drop `<head>`, scripts, styles, the inline-XBRL header and every `display:none` element; one block per paragraph-like element and per table row; pages counted from CSS page breaks; zero-width characters removed (Kroger uses them as spacers: 12,987 blocks → 5,341).
- **Stage 2, headings:** a candidate is a block of ≤ 250 characters that starts with "Item N". Every test-set filing lists Items 1–16 twice (table of contents, then body), and cross-references sit inside long paragraphs, so the **last** candidate per item is the real heading. A section ends at the next detected item of any number, so tiny items (1B "None", 6 "Reserved") still end the one before. A bare heading ("ITEM 1.") takes its title from the next line. Out-of-order headings produce a warning.
- **Rejected:** "first candidate followed by enough text" (tiny real items like 1B have 1–22 words after them, so the section before would run on).
- **Result:** all five target items (1, 1A, 7, 7A, 8) found in all seven fixtures, in order, with correct titles and openings; 26–155 ms per filing.
- **Page numbers** are counted from page breaks (cover = page 1), so they can differ from the numbers printed in a filing's footer. Revisit in the chunker task if citations should show printed page numbers.

## 2026-11-24: Passages of ~300 tokens; Item 8 tables skipped
- **Size:** target ~300 tokens, never over 450, no overlap. Built from whole paragraphs, split at sentence ends only when a paragraph is too long (words as a last resort). Token counts are estimates (1.33 per word; Voyage's tokenizer isn't available offline).
- **Structure:** a subheading (≤ 12 words, no sentence-ending punctuation) starts a new passage and is stored as its `heading`; text and data-table passages are kept apart; any passage under 60 tokens is merged into the next (or previous) one when it fits.
- **Tables:** a table is "data" if ≥ 30% of its non-empty cells are numeric; otherwise it's layout (bullets) and treated as text. Data-table rows are dropped in Item 8 (XBRL has those numbers exactly; the notes' text is kept) and become their own passages elsewhere (MD&A segment and comparable-sales tables).
- **Page furniture removed before chunking:** bare page numbers, "Table of Contents" links, and running headers (a short line on ≥ 8 occasions and ≥ 20% of pages, e.g. "Walmart Inc.").
- **Bugs found on real data and fixed:** cells wrapping their text in `<p>`/`<div>` (Kroger: 97% of cells) split table rows apart and broke data-table detection (Kroger 908 → 269 passages); page numbers and running headers made 110 passages under 20 tokens (now 4, all legitimate small tables or captions).
- **Result on the seven fixtures:** 1,598 passages (167–291 per 10-K, ~4,800 for 21 filings); median 120–273 tokens per section; nothing over 450; every kept paragraph appears intact in the passages (tested).
- **Alternatives:** ~500 tokens with 50-token overlap (broader citations, repeated text); keeping all tables (noisy number-only passages duplicating XBRL); skipping all tables (loses MD&A tables).

## 2026-11-24: sections and chunks tables; ingest step 6 fills them
- **Schema:** `chunks` stores a page range, heading, kind, word and token counts; copies `company_id`, `fiscal_year` and `item` so search filters on one table; `search_text` is generated from heading + content with English stemming. Unique (filing, item) and (section, chunk_index); RLS read-only for the browser key. `embedding vector(1024)` stays empty until milestone 3, with `embedding_model` required whenever it's set.
- **Vector index deferred** to milestone 3, when the distance measure (and possibly half-size vectors) is chosen.
- **Stemming caveat (seen in the test):** "competitive" and "competition" share a stem; "competitors" doesn't. Keyword search alone misses some variants, one reason search will combine keywords with embeddings.
- **Step 6 (parse):** for each downloaded 10-K in the window not yet parsed (or all with `--reparse`), read it from Storage, parse and chunk it, replace its sections and chunks, then mark it parsed; missing items are warnings, not failures.
- **Result:** all 21 stored 10-Ks (fiscal 2023–2025) parsed with all five items, including the 14 the parser was never developed against; 105 sections, 4,874 passages (262 tables), average 198 tokens, 15 MB; database 46 MB.
- **Alternatives:** joining to `filings` for the year at search time; creating a cosine HNSW index now.

## 2026-11-24: Open issue: stock splits leave older per-share values unadjusted
- **Finding:** "latest reported" only adjusts years that a post-split 10-K re-reports (a 10-K covers three years of earnings). Older years keep pre-split values. Walmart (3-for-1, February 2024): fiscal 2020 diluted EPS $4.75 on 2.85B shares, fiscal 2021 $1.62 on 8.4B shares, a false −66% drop. Kroger (2-for-1, 2015): fiscal 2012 $2.77, fiscal 2013 $1.45.
- **Not a storage bug:** `financial_facts` holds exactly what was reported. The fix belongs where values are compared.
- **Options for the ratio engine task:** (a) detect splits from periods reported both before and after (value ratio ≈ 2, 3, 1.5…) and scale earlier per-share and share-count values by that factor, which uses only XBRL numbers; (b) mark per-share comparisons across a detected split as not comparable; (c) both: adjust when the ratio is clean, otherwise mark not comparable. The SEC's split-ratio tag isn't among the stored annual facts for any test-set company, so detection has to come from the overlapping values.

## 2026-11-24: Retail profile: 12 metrics, tag orders from real data
- **Metrics:** revenue growth, gross margin, operating margin, net margin, inventory turnover, days inventory outstanding, current ratio, cash conversion (operating cash flow ÷ net income), free-cash-flow margin, diluted EPS growth, return on assets, receivables growth vs revenue. Stored as plain numbers (fractions for percentages); a non-positive denominator gives "not applicable" with a reason, never a division by zero.
- **Tag orders (checked on fiscal 2019–2025 for all 7 companies):** `Revenues` before contract revenue, because for Walmart it's total revenue ($681.0B vs $674.5B in fiscal 2024, the difference being membership and other income); `ReceivablesNetCurrent` before `AccountsReceivableNet`, because Walmart's balance-sheet receivables are $9.98B and the other tag ($4.4B) is a component; `NetIncomeLossAvailableToCommonStockholdersBasic` as a fallback for Target's fiscal 2019.
- **Notes on tags:** Kroger's only cost-of-sales tag excludes depreciation, so it's used with a "not directly comparable" note; Kroger's capex tag may include intangibles; `ProfitLoss` includes noncontrolling interests.
- **Expected gaps ("not applicable"):** inventory for Kroger (no standard tag in any filing since 2019, likely a company-specific tag the SEC's company facts don't include) and Adobe; receivables for Target and Five Below (none reported). Coverage report (`npm run profile:coverage`): every other input resolves in all 7 years for every company.
- **Gross margin uses total revenue**, the same definition for every company. Some retailers quote margins on net sales instead, so figures can differ slightly from a company's own.
- **Alternatives:** gross margin only where `GrossProfit` is tagged (only Gap, Adobe and some years of Five Below and Costco do); dropping Kroger's cost of sales (strictly comparable, but no margins for the grocer).

## 2026-11-24: Non-retail companies get the "unprofiled" sector profile for now
- **Decision:** SIC 5200–5999 (retail trade) → `retail`; anything else, like Adobe (7372) → `unprofiled`.
- **Why:** v1 only has a retail profile; the label makes the crash-test case explicit. How the ratio engine treats `unprofiled` is decided in the profile task.

## 2026-11-24: Bare-bones frontend before milestone 3
- **Decision:** build an unstyled frontend now (the app is called "Filer" on screen), before search and Q&A: a landing page ("Filer", a company search box, a year-range slider) and a results page that lists everything the pipeline produces for the chosen company and years. Visual design (the mockup) comes later, in milestone 4.
- **Why:** frontend work takes many small rounds of "do I like this?", so starting early spreads it out. A plain page also shows exactly which features exist today, and which numbers clutter the screen or are missing, before any design effort goes into them.
- **Search reads, it doesn't fetch:** pressing Enter only reads rows that `npm run ingest` already wrote (no SEC or AI calls), so the page is fast and costs nothing. Loading new companies on demand stays out of scope for v1.
- **Year slider:** two handles over the company's downloaded 10-K years only. If the downloaded years have a gap (e.g. 2020, 2021, 2023), the slider covers only the latest unbroken run, so a range with a missing year can't be picked.
- **Data access:** pages read Supabase on the server with the publishable (read-only) key; the secret key is never used by the web app.
- **Alternatives:** keeping the original order (frontend after Q&A); building the full milestone 4 design first.

## 2026-11-24: SG&A, buybacks, dividends and long-term debt shown as display-only inputs
- **Decision:** four inputs added to the retail profile and shown in Key financials, with no metric built on them yet (`displayOnly: true`); the XBRL tag column is removed from the page (the tag shows on hover).
- **Tag orders (fiscal 2019–2025, all seven companies):** SG&A `SellingGeneralAndAdministrativeExpense`, then `OperatingExpenses` with a note (Gap reports one operating-expenses line; Adobe's includes R&D). Kroger has no standard SG&A tag, so it shows "—". Buybacks `PaymentsForRepurchaseOfCommonStock` for all seven. Dividends: common-stock dividends, then all dividends (Gap; Costco before 2021); Five Below and Adobe pay none. Long-term debt: noncurrent first, then Target's tag including finance leases, then Adobe's total including the current portion, each with a note.
- **Why display-only:** which ratios to build from them (SG&A as a share of revenue, shareholder payout, debt to assets...) is a separate choice.
- **Alternatives:** adding metrics at the same time; summing Adobe's sales-and-marketing and G&A lines (the profile has no sums, and Adobe is only the crash test).

## 2026-11-24: Citations open the 10-K in a side panel
- **Decision:** each cited claim in an answer gets a small book icon. Clicking it opens a panel on the right that shows the whole 10-K section the passage comes from, rebuilt from the stored passages, scrolled to the cited passage and highlighted, with the page numbers and a link to the original filing on sec.gov. The panel can be collapsed.
- **Why rebuild from passages:** we already store every passage of Items 1, 1A, 7, 7A and 8 in order, with pages, so the panel needs no new data and the highlight is exact (the citation points at a passage id). Showing the SEC's own HTML in a frame would need locating the passage inside raw HTML, and sec.gov may refuse to be framed.
- **Alternatives:** a popup with just the cited passage (no context); linking straight to sec.gov (no highlight, leaves the app).

## 2026-11-24: Embeddings with Voyage voyage-4, 1024 dimensions
- **Model:** `voyage-4` (Voyage docs checked 2026-11-24): 1024 dimensions by default, matching `chunks.embedding vector(1024)`; $0.06 per million tokens with the first 200M tokens free per account. All 4,874 passages are about 1M tokens, so embedding them uses ~0.5% of the free tokens.
- **Text embedded:** each passage prefixed with its section title and subheading (e.g. "Item 7. Management's Discussion… — Gross profit rate"), so a passage that never names its topic is still found by it. `input_type` is "document" for passages and "query" for questions.
- **Requests:** at most 128 passages or ~50,000 estimated tokens per request (Voyage allows 1,000 inputs and 320K tokens); retries with backoff on 429 and 5xx; a hard cap on requests per run. Voyage's docs don't state limits for accounts without a payment method (they're known to be very low); with a card the limit is 2,000 requests and 8M tokens a minute, and the free tokens still apply.
- **Where it runs:** step 7 of `npm run ingest`, only for passages without an embedding; a filing becomes `embedded` when all its passages have one. Re-parsing deletes the passages, so they're embedded again.
- **Result (2026-11-24):** all 4,874 passages embedded in 42 requests and every filing marked `embedded`; Walmart's 855 passages were 186,143 Voyage tokens, so the test set is roughly 1M of the 200M free. Stored vectors have length 1.0 (normalized), so cosine similarity equals the dot product. Sanity check: "Why did gross profit margin change?" against Walmart fiscal 2025 ranks the MD&A "Margin" passage first and the executive-officer list last.
- **Alternatives:** `voyage-4-lite` (cheaper, a little less accurate; cost isn't a constraint at this size); `voyage-finance-2` (finance-tuned, but older, no free tokens beyond 50M, fixed 1024); the Batch API (33% cheaper but free tokens don't apply).

## 2026-11-24: Hybrid search: one Postgres function, rank fusion, no vector index yet
- **Decision:** `search_chunks(query_embedding, query_text, company, from_year, to_year, match_count, items)` builds two ranked lists over the company's passages in the year range (closest embeddings by cosine distance; full-text matches by `ts_rank_cd`), takes the top 4× `match_count` of each, and merges them with Reciprocal Rank Fusion: score = 1/(60 + meaning rank) + 1/(60 + keyword rank). Returns at most 50.
- **Why rank fusion:** cosine similarity and keyword rank are on different scales, so adding them would need tuning; ranks combine without any. A passage near the top of both lists wins (maximum score 2/61 ≈ 0.0328).
- **Keywords are OR-ed:** questions are prose, so requiring every word would miss most passages; "&" from `websearch_to_tsquery` becomes "|" (negations kept), and passages matching more words still rank higher.
- **No vector index:** one company over a few years is ~800 passages, so exact distance takes milliseconds and is always complete. An approximate HNSW index combined with the company filter can silently return fewer passages than asked for. Revisit if the data grows a lot (pgvector 0.8's iterative index scans address the filtering problem).
- **Security:** `security invoker`, so the read-only RLS policy on chunks applies; executable by the browser key.
- **Tried on real questions (`npm run search`):** Walmart margins (top passage first in both lists), Kroger "LIFO charge" (keyword rank 1 lifted the LIFO/FIFO passage from meaning rank 6 to first), Target tariffs within Risk Factors only, Gap Old Navy comparable sales. An unanswerable question ("the CEO's favorite color") still returns passages, but each sits in only one list (scores ≈ 0.016 vs ≈ 0.03), so the Q&A step must decide from the text whether the passages answer the question.
- **Known issue:** some Target passages have the running header "RISK FACTORS Table of Contents" as their subheading; harmless for search, but worth fixing in the parser before the citation panel shows headings.
- **Alternatives:** semantic search only (misses exact terms like "LIFO"); a weighted sum of normalized scores (needs tuning); an HNSW index now.

## 2026-11-24: Q&A with Claude citations over search results
- **Decision:** `answerQuestion` sends the top 8 passages from hybrid search as `search_result` blocks (source `chunk:<id>`, title like "Walmart Inc. FY2025 10-K · Item 7 · Margin (p. 35)", citations enabled), then the question. Claude's citations come back as `search_result_location` with the index of the passage, so every cited sentence maps to one stored passage, which is what the citation side panel needs. One request per question, no loop.
- **Dependency:** `@anthropic-ai/sdk` 1.14.0 (approved 2026-11-24): typed requests and replies, retries and typed errors.
- **Models (CLAUDE.md, checked in the Anthropic docs 2026-11-24):** `claude-haiku-5-5` ($0.10 / $0.50 per million tokens) while developing, about $0.001 a question; `claude-sonnet-5-5` ($2 / $10) for Q&A and final evals, about $0.02 a question. Effort `medium`, adaptive thinking (the default). Sonnet 5.5 requests carry the server-side refusal fallback (`fallbacks: "default"`); a refusal that still happens is reported as `declined`, never shown as an answer.
- **Status, not guessed from free text:** Claude is told to open with "The filings don't answer this question." or "The filings only partly answer this question." when that's the case; the code checks for those exact sentences (`not_answered`, `partly_answered`). An answer with no citations is also `not_answered`. Found in testing: asked for Costco's CEO's favorite color, Claude correctly said the filing doesn't say but cited the CEO's bio, so "any citation = answered" was wrong.
- **Prompt rules:** only the passages, no outside knowledge; figures exactly as written and no new calculations (numbers are checked against XBRL in the next task); own words, no repeated passage sentences (Haiku repeated a cited sentence before this rule); short prose; no investment advice.
- **Tried (`npm run ask`):** Walmart gross margin (Haiku and Sonnet), Kroger LIFO across three years, Target tariffs, Gap Old Navy comps plus an unanswerable forecast (partly answered), Costco CEO's favorite color (not answered).
- **Known quirks:** Haiku sometimes pastes table fragments into a sentence ("Old Navy Global 3 % 3 %"); Sonnet used bold labels and bullets despite the instruction. Formatting only; revisit with the Ask screen.
- **Alternatives:** a second, structured call to classify answered / partly / not (sturdier, one more request per question; switch to it if evals show the fixed openings are missed); custom-content documents instead of search results (same citations, less natural for retrieved passages); Opus 5.5 (stronger, but CLAUDE.md sets Haiku/Sonnet for cost).

## 2026-11-24: Number check: unique XBRL match, else the filing text, else unverified
- **Decision:** `checkFigures` pulls dollar amounts, percentages and basis points out of an answer and gives each one a status: `xbrl` (exactly one line item in `financial_facts` has that value within the rounding written, e.g. "$157 million" = 156.5–157.5M, sign ignored), `passage` (otherwise, the figure appears in the passages Claude was given), or `unverified` (neither: possibly calculated or made up). Facts come from the searched years plus the two before (each 10-K reports three years).
- **Rules learned on real answers:** the first version counted any fact of that size as a match, and coincidences were everywhere: Kroger's $113M LIFO charge (2023) matched a 2025 receivables change; "$157 million" matched 7 facts; "$1.0 billion" 11; "3%" matched a 2.5% tax-rate reconciliation line. Now:
  - dollar amounts only, with at least 3 significant digits (with 2, a unique "$1.3 billion" match was an unrelated deferred tax asset);
  - percentages and basis points are checked against the text only (companies define their own ratios; Walmart's gross profit rate is of net sales, ours of total revenue);
  - a year in the same sentence narrows the facts to that fiscal year or the one before ("fiscal 2026" is our 2025 for Walmart);
  - the value must belong to one line item; otherwise it isn't counted as XBRL and the result records how many items share it.
- **Result after the fix:** Kroger's LIFO charges for 2022–2024 match `InventoryLIFOReservePeriodCharge` in the right years; Walmart operating income matches `OperatingIncomeLoss`; ambiguous and coarse figures are verified from the text instead; no unverified figures in four test answers.
- **What the badge can claim:** "matches XBRL" = the only reported line item with that value; "quoted from the filing" = present in the cited text; "unverified" is shown, never hidden.
- **Alternatives:** comparing percentages with our ratios (wrong when definitions differ); asking Claude to tag each figure with its XBRL concept (the AI would be checking itself); a fixed relative tolerance such as 1% (ignores how precisely the answer stated the number).
