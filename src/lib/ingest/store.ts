/**
 * Everything the ingest pipeline needs from the database, as one interface.
 * The real implementation (supabase-store.ts) uses supabase-js; tests use an
 * in-memory fake. Column names match the tables in supabase/migrations/.
 */

export interface CompanyRow {
  cik: string;
  ticker: string;
  name: string;
  sic_code: string | null;
  sector_profile: string;
  fiscal_year_end: string | null;
}

export interface FilingRow {
  company_id: number;
  accession_no: string;
  form: string;
  fiscal_year: number;
  period_end: string;
  filed_at: string;
  primary_document: string;
  // status and storage_path are deliberately absent: re-running submissions
  // must not reset what later steps (download, parse) have recorded.
}

export interface FactRow {
  company_id: number;
  concept: string;
  unit: string;
  value: number;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  accession_no: string;
  filed_at: string;
  form: string;
}

export interface RatioRow {
  company_id: number;
  fiscal_year: number;
  metric: string;
  status: "ok" | "not_applicable";
  value: number | null;
  reason: string | null;
  inputs: { values: Record<string, unknown>; notes: string[] };
  profile: string;
  computed_at: string;
}

export interface RedFlagRow {
  company_id: number;
  fiscal_year: number;
  rule: string;
  detail: string;
  evidence: { values: Record<string, number>; notes: string[] };
}

/** A filings row as stored, for steps that work on documents. */
export interface StoredFiling {
  accession_no: string;
  fiscal_year: number;
  primary_document: string;
  storage_path: string | null;
  status: string;
}

export type RunStatus = "running" | "success" | "failed";

export interface RunUpdate {
  company_id?: number;
  status?: RunStatus;
  step?: string;
  counts?: Record<string, number>;
  error?: string;
  finished_at?: string;
}

export interface IngestStore {
  /** Creates an ingestion_runs row and returns its id. */
  startRun(ticker: string, params: Record<string, unknown>): Promise<number>;
  updateRun(runId: number, update: RunUpdate): Promise<void>;
  /** Inserts or updates by CIK; returns the company id. */
  upsertCompany(row: CompanyRow): Promise<number>;
  /** Inserts or updates by accession number; returns how many rows were written. */
  upsertFilings(rows: readonly FilingRow[]): Promise<number>;
  /** Inserts or updates by (company, concept, unit, period); returns how many rows were written. */
  upsertFacts(rows: readonly FactRow[]): Promise<number>;
  /** Inserts or updates by (company, fiscal year, metric); returns how many rows were written. */
  upsertRatios(rows: readonly RatioRow[]): Promise<number>;
  /**
   * Replaces all of a company's red flags. Replace, not upsert: a flag that
   * no longer fires (e.g. after a restatement) must disappear.
   */
  replaceRedFlags(companyId: number, rows: readonly RedFlagRow[]): Promise<number>;

  // --- raw filing documents (Supabase Storage, bucket raw-filings) ---
  getFilings(companyId: number): Promise<StoredFiling[]>;
  /** True if a file already exists at this path in the bucket. */
  documentExists(path: string): Promise<boolean>;
  /** Uploads without overwriting; "exists" if something is already at the path. */
  uploadDocument(path: string, bytes: Uint8Array): Promise<"uploaded" | "exists">;
  /** Records where a filing's document is stored and sets status to downloaded. */
  markDownloaded(accessionNo: string, storagePath: string): Promise<void>;
}
