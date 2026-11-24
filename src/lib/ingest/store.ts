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
}
