// npm run risks [-- --ticker WMT] [-- --model sonnet]
// Compares each company's Risk Factors year over year (consecutive downloaded
// 10-Ks), has Claude summarize the changes in one Message Batch (Haiku by
// default, CLAUDE.md), and replaces the rows in risk_changes.
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { parseFiling } from "../src/lib/filings/sections.ts";
import { DEV_MODEL, QA_MODEL } from "../src/lib/qa/answer.ts";
import type { RiskChangeRow } from "../src/lib/risks/changes.ts";
import { runRiskPipeline, type RiskCompany, type StoredSummary } from "../src/lib/risks/pipeline.ts";
import { splitRisks } from "../src/lib/risks/split.ts";
import { runBatch, type BatchApi } from "../src/lib/risks/summarize.ts";

const { values } = parseArgs({ options: { ticker: { type: "string" }, model: { type: "string" } } });
const model = values.model === "sonnet" ? QA_MODEL : DEV_MODEL;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret || !process.env.ANTHROPIC_API_KEY) throw new Error("Missing Supabase or Anthropic settings (run npm run check:env)");
const db = createClient(url, secret, { auth: { persistSession: false } });
const anthropic = new Anthropic();

let query = db.from("companies").select("id, name, ticker, filings(fiscal_year, storage_path)").order("ticker");
if (values.ticker) query = query.eq("ticker", values.ticker.toUpperCase());
const { data, error } = await query;
if (error) throw new Error(error.message);
const companies: RiskCompany[] = ((data ?? []) as unknown as { id: number; name: string; ticker: string; filings: { fiscal_year: number; storage_path: string | null }[] }[]).map(
  (c) => ({ id: Number(c.id), name: c.name, ticker: c.ticker, years: c.filings.filter((f) => f.storage_path).map((f) => f.fiscal_year) }),
);
if (companies.length === 0) throw new Error(values.ticker ? `${values.ticker} is not loaded` : "No companies loaded");

// The SDK's batches resource, narrowed to what runBatch uses.
const batches: BatchApi = {
  create: (body) => anthropic.messages.batches.create(body),
  retrieve: (id) => anthropic.messages.batches.retrieve(id),
  results: async (id) => (await anthropic.messages.batches.results(id)) as unknown as AsyncIterable<{ custom_id: string; result: { type: string; message?: Anthropic.Messages.Message } }>,
};

console.log(`Comparing Risk Factors for ${companies.map((c) => c.ticker).join(", ")} (summaries by ${model})...`);
const started = Date.now();
const result = await runRiskPipeline(companies, {
  model,
  async loadRisks(ticker, year) {
    const { data: file, error: dlError } = await db.storage.from("raw-filings").download(`${ticker}/${year}.htm`);
    if (dlError || !file) throw new Error(`Download ${ticker}/${year}.htm failed: ${dlError?.message ?? "no data"}`);
    const section = parseFiling(new Uint8Array(await file.arrayBuffer())).sections.find((s) => s.item === "1A");
    return section ? splitRisks(section.blocks) : [];
  },
  async storedSummaries(companyId) {
    const { data: rows, error: readError } = await db
      .from("risk_changes")
      .select("change_key, summary, materiality, model")
      .eq("company_id", companyId)
      .not("summary", "is", null);
    if (readError) throw new Error(readError.message);
    return new Map(
      ((rows ?? []) as { change_key: string; summary: string; materiality: StoredSummary["materiality"]; model: string | null }[]).map((r) => [
        r.change_key,
        { summary: r.summary, materiality: r.materiality, model: r.model },
      ]),
    );
  },
  runBatch: (requests) => {
    if (requests.length > 0) console.log(`  submitting ${requests.length} summary requests as one batch...`);
    return runBatch(batches, requests, {
      onPoll: (c) => console.log(`  batch: ${c.succeeded} done, ${c.processing} processing, ${c.errored} errored`),
    });
  },
  async replaceRows(companyId, fromYear, toYear, rows: readonly RiskChangeRow[]) {
    const del = await db.from("risk_changes").delete().eq("company_id", companyId).eq("from_year", fromYear).eq("to_year", toYear);
    if (del.error) throw new Error(del.error.message);
    const { error: insError, count } = await db.from("risk_changes").insert([...rows], { count: "exact" });
    if (insError) throw new Error(insError.message);
    return count ?? rows.length;
  },
});

for (const p of result.pairs) {
  const c = p.counts;
  console.log(
    `  ${p.ticker.padEnd(5)} FY${p.fromYear}→FY${p.toYear}: ${c.added ?? 0} added, ${c.removed ?? 0} removed, ${c.modified ?? 0} modified, ${c.unchanged ?? 0} unchanged`,
  );
}
console.log(
  `Done in ${Math.round((Date.now() - started) / 1000)} s: ${result.rows} rows, ${result.summarized} new summaries, ${result.reused} reused, ${result.failed} without a summary (retried next run).`,
);
