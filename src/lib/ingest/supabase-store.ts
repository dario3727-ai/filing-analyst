/**
 * IngestStore backed by Supabase. Server and scripts only: it uses the
 * SECRET key, which bypasses row-level security. Never import this from
 * browser code.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkEnv, type Env } from "../env.ts";
import type {
  CompanyRow,
  FactRow,
  FilingRow,
  IngestStore,
  RatioRow,
  RedFlagRow,
  RunUpdate,
  StoredFiling,
} from "./store.ts";

export const RAW_FILINGS_BUCKET = "raw-filings";

/** Rows per upsert request: keeps each request small; ~4,000 facts → 8 requests. */
export const FACT_BATCH_SIZE = 500;

function fail(operation: string, message: string): never {
  throw new Error(`Supabase ${operation} failed: ${message}`);
}

/** supabase-js returns untyped rows without generated types, so check the id ourselves. */
function idFrom(data: unknown, operation: string): number {
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== "number") fail(operation, "no id returned");
  return id;
}

export function createSupabaseStore(client: SupabaseClient): IngestStore {
  return {
    async startRun(ticker, params) {
      const { data, error } = await client.from("ingestion_runs").insert({ ticker, params }).select("id").single();
      if (error) fail("start run", error.message);
      return idFrom(data, "start run");
    },

    async updateRun(runId: number, update: RunUpdate) {
      const { error } = await client.from("ingestion_runs").update(update).eq("id", runId);
      if (error) fail("update run", error.message);
    },

    async upsertCompany(row: CompanyRow) {
      const { data, error } = await client.from("companies").upsert(row, { onConflict: "cik" }).select("id").single();
      if (error) fail("upsert company", error.message);
      return idFrom(data, "upsert company");
    },

    async upsertFilings(rows: readonly FilingRow[]) {
      if (rows.length === 0) return 0;
      const { data, error } = await client
        .from("filings")
        .upsert([...rows], { onConflict: "accession_no" })
        .select("id");
      if (error) fail("upsert filings", error.message);
      return Array.isArray(data) ? data.length : 0;
    },

    async upsertFacts(rows: readonly FactRow[]) {
      let written = 0;
      for (let i = 0; i < rows.length; i += FACT_BATCH_SIZE) {
        const batch = rows.slice(i, i + FACT_BATCH_SIZE);
        // Same columns as the financial_facts_one_per_period unique constraint.
        const { error, count } = await client
          .from("financial_facts")
          .upsert([...batch], { onConflict: "company_id,concept,unit,period_start,period_end", count: "exact" });
        if (error) fail(`upsert facts (rows ${i + 1}–${i + batch.length})`, error.message);
        written += count ?? batch.length;
      }
      return written;
    },

    async upsertRatios(rows: readonly RatioRow[]) {
      let written = 0;
      for (let i = 0; i < rows.length; i += FACT_BATCH_SIZE) {
        const batch = rows.slice(i, i + FACT_BATCH_SIZE);
        const { error, count } = await client
          .from("ratios")
          .upsert([...batch], { onConflict: "company_id,fiscal_year,metric", count: "exact" });
        if (error) fail(`upsert ratios (rows ${i + 1}–${i + batch.length})`, error.message);
        written += count ?? batch.length;
      }
      return written;
    },

    async replaceRedFlags(companyId: number, rows: readonly RedFlagRow[]) {
      // Two requests, not one transaction: if the insert fails, the run is
      // logged as failed and the next run rebuilds the flags.
      const { error: deleteError } = await client.from("red_flags").delete().eq("company_id", companyId);
      if (deleteError) fail("delete red flags", deleteError.message);
      if (rows.length === 0) return 0;
      const { error, count } = await client.from("red_flags").insert([...rows], { count: "exact" });
      if (error) fail("insert red flags", error.message);
      return count ?? rows.length;
    },

    async getFilings(companyId: number) {
      const { data, error } = await client
        .from("filings")
        .select("id, accession_no, fiscal_year, primary_document, storage_path, status")
        .eq("company_id", companyId);
      if (error) fail("get filings", error.message);
      return (data ?? []).map(
        (r): StoredFiling => ({
          id: Number(r.id),
          accession_no: String(r.accession_no),
          fiscal_year: Number(r.fiscal_year),
          primary_document: String(r.primary_document),
          storage_path: r.storage_path === null ? null : String(r.storage_path),
          status: String(r.status),
        }),
      );
    },

    async documentExists(path: string) {
      const slash = path.lastIndexOf("/");
      const folder = slash === -1 ? "" : path.slice(0, slash);
      const name = path.slice(slash + 1);
      const { data, error } = await client.storage.from(RAW_FILINGS_BUCKET).list(folder, { search: name, limit: 100 });
      if (error) fail("check document", error.message);
      return (data ?? []).some((item) => item.name === name);
    },

    async uploadDocument(path: string, bytes: Uint8Array) {
      const { error } = await client.storage
        .from(RAW_FILINGS_BUCKET)
        .upload(path, bytes, { contentType: "text/html", upsert: false });
      if (!error) return "uploaded";
      // Never overwrite: an existing file means it's already saved.
      const status = (error as { statusCode?: string | number }).statusCode;
      if (String(status) === "409" || /already exists/i.test(error.message)) return "exists";
      fail(`upload ${path}`, error.message);
    },

    async markDownloaded(accessionNo: string, storagePath: string) {
      const { error } = await client
        .from("filings")
        .update({ storage_path: storagePath, status: "downloaded" })
        .eq("accession_no", accessionNo);
      if (error) fail("mark filing downloaded", error.message);
    },

    async downloadDocument(path: string) {
      const { data, error } = await client.storage.from(RAW_FILINGS_BUCKET).download(path);
      if (error || !data) fail(`download ${path}`, error?.message ?? "no data");
      return new Uint8Array(await data.arrayBuffer());
    },

    async replaceFilingText(filing, sections) {
      // Deleting the sections deletes their chunks too (on delete cascade).
      const { error: deleteError } = await client.from("sections").delete().eq("filing_id", filing.id);
      if (deleteError) fail("delete sections", deleteError.message);
      if (sections.length === 0) return 0;

      const { data: inserted, error: sectionError } = await client
        .from("sections")
        .insert(
          sections.map((s) => ({
            filing_id: filing.id,
            item: s.item,
            title: s.title,
            page_start: s.page_start,
            page_end: s.page_end,
            word_count: s.word_count,
          })),
        )
        .select("id, item");
      if (sectionError) fail("insert sections", sectionError.message);
      const sectionIds = new Map((inserted ?? []).map((r) => [String(r.item), Number(r.id)]));

      const rows = sections.flatMap((s) =>
        s.chunks.map((c) => ({
          ...c,
          section_id: sectionIds.get(s.item),
          filing_id: filing.id,
          company_id: filing.company_id,
          fiscal_year: filing.fiscal_year,
          item: s.item,
        })),
      );
      let written = 0;
      for (let i = 0; i < rows.length; i += FACT_BATCH_SIZE) {
        const batch = rows.slice(i, i + FACT_BATCH_SIZE);
        const { error, count } = await client.from("chunks").insert(batch, { count: "exact" });
        if (error) fail(`insert chunks (rows ${i + 1}–${i + batch.length})`, error.message);
        written += count ?? batch.length;
      }
      return written;
    },

    async markParsed(filingId: number) {
      const { error } = await client.from("filings").update({ status: "parsed" }).eq("id", filingId);
      if (error) fail("mark filing parsed", error.message);
    },
  };
}

/** Builds the store from .env.local, with clear errors that never print key values. */
export function createSupabaseStoreFromEnv(env: Env = process.env): IngestStore {
  const results = checkEnv(env);
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
    const result = results.find((r) => r.name === name);
    if (result?.status !== "ok") throw new Error(`${name} ${result?.problem ?? "is not set"} (fix it in .env.local)`);
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = env.SUPABASE_SECRET_KEY ?? "";
  const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return createSupabaseStore(client);
}
