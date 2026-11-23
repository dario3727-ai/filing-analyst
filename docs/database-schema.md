# Database schema (draft)

A starting point, not final. Change it through migrations as real data teaches us more. Expected size for v1 (about 7 companies × 3 years): well under the Supabase free tier's 500 MB.

## Tables

### companies
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| cik | text, unique | 10-digit, zero-padded |
| ticker | text | |
| name | text | |
| sic_code | text | |
| sector_profile | text | `retail` in v1; the crash-test company gets its own value |
| fiscal_year_end | text | MM-DD |
| created_at | timestamptz | |

### filings
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| company_id | bigint → companies | |
| accession_no | text, unique | |
| form | text | `10-K` |
| fiscal_year | int | |
| period_end | date | |
| filed_at | date | |
| primary_doc_url | text | |
| storage_path | text | raw HTML in the `raw-filings` bucket |
| status | text | `pending`, `downloaded`, `parsed`, `embedded`, `failed` |

### financial_facts
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| company_id | bigint → companies | |
| concept | text | e.g. `us-gaap:Revenues` |
| value | numeric | |
| unit | text | `USD`, `USD/shares`, `shares` |
| period_start | date | null for point-in-time values |
| period_end | date | |
| fiscal_year | int | |
| fiscal_period | text | `FY` in v1 |
| accession_no | text | filing that reported it |

Unique on (company_id, concept, unit, period_start, period_end, fiscal_period) to prevent duplicates.

### ratios
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| company_id | bigint → companies | |
| fiscal_year | int | |
| metric | text | e.g. `gross_margin` |
| value | numeric | null when not applicable |
| status | text | `ok` or `not_applicable` |
| reason | text | why it's not applicable |
| inputs | jsonb | the facts used, for traceability |

### red_flags
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| company_id | bigint → companies | |
| fiscal_year | int | |
| rule | text | e.g. `receivables_outpace_revenue` |
| detail | text | e.g. "AR +19% vs revenue +5%" |
| values | jsonb | numbers that triggered it |

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

### ingestion_runs
| Column | Type | Notes |
| --- | --- | --- |
| id | bigint, PK | |
| company_id | bigint → companies | |
| started_at, finished_at | timestamptz | |
| status | text | `running`, `success`, `failed` |
| step | text | last step reached |
| counts | jsonb | filings, facts, chunks… |
| error | text | |

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
