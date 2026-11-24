/**
 * Ingest step 2: SEC company facts → financial_facts.
 * Stores annual facts for every year available (not only the window): it's
 * one request either way and small (decision 2026-11-24).
 */
import type { SecClient } from "../sec/client.ts";
import { parseCompanyFacts, selectAnnualFacts, type FactStats, type Restatement } from "../sec/companyfacts.ts";
import { companyFactsUrl } from "../sec/urls.ts";
import type { IngestStore } from "./store.ts";

export interface FactsStepResult {
  stats: FactStats;
  stored: number;
  firstYear: number | null;
  lastYear: number | null;
  /** A few restatements for the run summary; the full count is in stats. */
  sampleRestatements: Restatement[];
}

export async function ingestCompanyFacts(
  sec: SecClient,
  store: IngestStore,
  companyId: number,
  cik: string,
): Promise<FactsStepResult> {
  const { facts: raw, skipped } = parseCompanyFacts(await sec.getJson(companyFactsUrl(cik)));
  const { facts, restatements, stats } = selectAnnualFacts(raw, skipped);

  const stored = await store.upsertFacts(
    facts.map((f) => ({
      company_id: companyId,
      concept: f.concept,
      unit: f.unit,
      value: f.value,
      period_start: f.periodStart,
      period_end: f.periodEnd,
      fiscal_year: f.fiscalYear,
      accession_no: f.accession,
      filed_at: f.filed,
      form: f.form,
    })),
  );

  const years = facts.map((f) => f.fiscalYear);
  // Show the biggest relative changes first: those are the interesting ones.
  const change = (r: Restatement) =>
    r.original.value === 0 ? Infinity : Math.abs((r.latest.value - r.original.value) / r.original.value);
  const sampleRestatements = [...restatements].sort((a, b) => change(b) - change(a)).slice(0, 3);

  return {
    stats,
    stored,
    firstYear: years.length > 0 ? Math.min(...years) : null,
    lastYear: years.length > 0 ? Math.max(...years) : null,
    sampleRestatements,
  };
}
