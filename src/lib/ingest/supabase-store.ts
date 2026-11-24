/**
 * IngestStore backed by Supabase. Server and scripts only: it uses the
 * SECRET key, which bypasses row-level security. Never import this from
 * browser code.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkEnv, type Env } from "../env.ts";
import type { CompanyRow, FactRow, FilingRow, IngestStore, RatioRow, RunUpdate } from "./store.ts";

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
