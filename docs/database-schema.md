# Database schema (draft)

A starting point, not final. Change it through migrations as real data teaches us more. Expected size for v1 (7 companies; all XBRL years, 10-K text for a window of up to ~7 years): roughly 200 MB, under the Supabase free tier's 500 MB. Measured and estimated figures are in `docs/decisions.md` (2026-11-24).

## Conventions

- **Fiscal year:** `fiscal_year` is the calendar year in which most of the fiscal year's months fall: a year ending 2026-01-31 is 2025, one ending 2026-08-30 is 2026. It's derived from period dates, never from the SEC's `fy` field, which is the year of the *filing* that reported a number (a 10-K repeats two prior years under its own `fy`). The UI shows "FY ending Jan 31, 2026" alongside the label.
- **Access:** row-level security is on for every table. `companies`, `filings`, `financial_facts`, `ratios` and `red_flags` have a read-only policy for the browser key; nothing else is readable or writable without the secret key.
- Tables marked *(built)* exist via migrations in `supabase/migrations/`; the rest are still drafts.

## Tables

### companies *(built)*
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint identity, PK | |
| cik | text, unique | 10 digits, zero-padded (checked) |
| ticker | text, unique | |
| name | text | |
| sic_code | text | SEC industry code |
| sector_profile | text | which metric profile to use; `retail` in v1 |
| fiscal_year_end | text | MM-DD (checked) |
| created_at, updated_at | timestamptz | `updated_at` kept current by a trigger |

### filings *(built)*
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint identity, PK | |
| company_id | bigint → companies | cascade delete |
| accession_no | text, unique | `0000000000-00-000000` format (checked) |
| form | text | `10-K` in v1 |
| fiscal_year | int | see Conventions |
| period_end | date | |
| filed_at | date | |
| primary_document | text | e.g. `wmt-20260131.htm`; URL built by `filingDocumentUrl()` |
| storage_path | text | raw HTML in the `raw-filings` bucket, once downloaded |
| status | text | `pending`, `downloaded`, `parsed`, `embedded`, `failed` (checked) |
| created_at, updated_at | timestamptz | |

Index on (company_id, fiscal_year).

### financial_facts *(built)*
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint identity, PK | |
| company_id | bigint → companies | cascade delete |
| concept | text | e.g. `us-gaap:Revenues` |
| unit | text | `USD`, `USD/shares`, `shares` |
| value | numeric | |
| period_start | date | null for point-in-time values (balance sheet) |
| period_end | date | |
| fiscal_year | int | see Conventions |
| accession_no | text | filing that supplied the value kept (not a foreign key: may be outside the ingestion window) |
| filed_at | date | |
| form | text | |

Unique on (company_id, concept, unit, period_start, period_end) with `NULLS NOT DISTINCT`, so point-in-time facts can't be duplicated. When several filings report the same period, the most recently filed value is kept (restatements win). Indexes on (company_id, fiscal_year) and (company_id, concept).

### ratios *(built)*
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint identity, PK | |
| company_id | bigint → companies | cascade delete |
| fiscal_year | int | |
| metric | text | e.g. `gross_margin` |
| status | text | `ok` or `not_applicable` (checked) |
| value | numeric | required when `ok`, null when `not_applicable` (checked) |
| reason | text | required when `not_applicable` (checked) |
| inputs | jsonb | the facts used, for traceability |
| profile | text | sector profile that produced it |
| computed_at | timestamptz | |

Unique on (company_id, fiscal_year, metric).

### red_flags *(built)*
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint identity, PK | |
| company_id | bigint → companies | cascade delete |
| fiscal_year | int | |
| rule | text | e.g. `receivables_outpace_revenue` |
| detail | text | e.g. "AR +19% vs revenue +5%" |
| evidence | jsonb | numbers that triggered it (renamed from `values`, a reserved SQL word) |
| detected_at | timestamptz | |

Unique on (company_id, fiscal_year, rule).

### sections
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| filing_id | bigint → filings | |
| item | text | `1`, `1A`, `7`, `8`… |
| title | text | |
| page_start, page_end | int | |
| word_count | int | |

### chunks
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| section_id | bigint → sections | |
| filing_id | bigint → filings | copied for fast filtering |
| company_id | bigint → companies | copied for fast filtering |
| chunk_index | int | order within the section |
| page | int | |
| content | text | |
| token_count | int | |
| embedding | vector(1024) | Voyage |
| search_text | tsvector | generated from content, for keyword search |

Indexes: vector index on `embedding`, GIN index on `search_text`, index on (company_id, filing_id).

### risk_changes
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| filing_id | bigint → filings | newer filing |
| prior_filing_id | bigint → filings | |
| change_type | text | `added`, `removed`, `reworded` |
| title | text | |
| summary | text | why it matters, one line |
| old_text, new_text | text | for reworded risks |
| chunk_id | bigint → chunks | source passage |

### ingestion_runs *(built, private)*
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint identity, PK | |
| company_id | bigint → companies | null if the run failed before the company was found |
| ticker | text | as requested |
| params | jsonb | e.g. `{"from": 2023, "to": 2025}` |
| status | text | `running`, `success`, `failed` (checked) |
| step | text | last step reached |
| counts | jsonb | filings, facts, ratios… |
| error | text | |
| started_at, finished_at | timestamptz | |

No read policy: not visible to the browser key.

### answers
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| company_id | bigint → companies | |
| question, answer | text | |
| citations | jsonb | chunk ids and quoted spans |
| numbers_checked | jsonb | each number and whether it matched XBRL |
| model | text | |
| input_tokens, output_tokens | int | |
| created_at | timestamptz | |

### eval_results
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| run_id | uuid | |
| question_id | text | |
| expected, actual | text | |
| number_correct | boolean | |
| citation_supports | boolean | |
| admitted_unknown | boolean | for questions the filing can't answer |
| model | text | |

## Storage

Bucket `raw-filings`: one HTML file per 10-K, path `{ticker}/{fiscal_year}.htm`.
