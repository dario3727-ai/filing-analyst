/**
 * Risk Factors comparison for one or more companies (decisions 2026-11-25):
 *   for each pair of consecutive downloaded 10-Ks → split, match, diff →
 *   reuse summaries already stored for identical changes → one batch of
 *   Claude requests for the rest → replace the pair's rows.
 * Every outside service is passed in, so tests run with fakes.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { buildChangeRows, needsSummary, type Materiality, type RiskChangeRow } from "./changes.ts";
import type { Risk } from "./split.ts";
import { parseSummary, summaryRequest } from "./summarize.ts";

export interface RiskCompany {
  id: number;
  name: string;
  ticker: string;
  /** Fiscal years with a downloaded 10-K, any order. */
  years: number[];
}

export interface StoredSummary {
  summary: string;
  materiality: Materiality;
  model: string | null;
}

export interface RiskPipelineDeps {
  model: string;
  loadRisks: (ticker: string, fiscalYear: number) => Promise<Risk[]>;
  /** Summaries already stored for this company, by change_key. */
  storedSummaries: (companyId: number) => Promise<Map<string, StoredSummary>>;
  /** Submits requests as one batch and returns succeeded messages by custom_id. */
  runBatch: (requests: { custom_id: string; params: Anthropic.Messages.MessageCreateParamsNonStreaming }[]) => Promise<Map<string, Anthropic.Messages.Message>>;
  replaceRows: (companyId: number, fromYear: number, toYear: number, rows: readonly RiskChangeRow[]) => Promise<number>;
}

export interface RiskPipelineResult {
  pairs: { ticker: string; fromYear: number; toYear: number; counts: Record<string, number> }[];
  summarized: number;
  reused: number;
  failed: number;
  rows: number;
}

/** Consecutive years only (2023→2024, 2024→2025): a gap means no comparison across it. */
export function consecutivePairs(years: readonly number[]): [number, number][] {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const pairs: [number, number][] = [];
  for (let i = 1; i < sorted.length; i++) if (sorted[i]! === sorted[i - 1]! + 1) pairs.push([sorted[i - 1]!, sorted[i]!]);
  return pairs;
}

export async function runRiskPipeline(companies: readonly RiskCompany[], deps: RiskPipelineDeps): Promise<RiskPipelineResult> {
  const result: RiskPipelineResult = { pairs: [], summarized: 0, reused: 0, failed: 0, rows: 0 };
  const work: { company: RiskCompany; fromYear: number; toYear: number; rows: RiskChangeRow[] }[] = [];

  for (const company of companies) {
    const stored = await deps.storedSummaries(company.id);
    const cache = new Map<number, Risk[]>();
    const risks = async (year: number) => {
      if (!cache.has(year)) cache.set(year, await deps.loadRisks(company.ticker, year));
      return cache.get(year)!;
    };
    for (const [fromYear, toYear] of consecutivePairs(company.years)) {
      const rows = buildChangeRows(company.id, fromYear, toYear, await risks(fromYear), await risks(toYear));
      for (const row of rows) {
        const previous = needsSummary(row) ? stored.get(row.change_key) : undefined;
        if (previous) {
          Object.assign(row, previous);
          result.reused++;
        }
      }
      work.push({ company, fromYear, toYear, rows });
    }
  }

  // One batch for every change still without a summary.
  const requests: { custom_id: string; params: Anthropic.Messages.MessageCreateParamsNonStreaming }[] = [];
  const byId = new Map<string, RiskChangeRow>();
  for (const w of work) {
    for (const row of w.rows.filter(needsSummary)) {
      const id = `r${requests.length}`;
      requests.push({ custom_id: id, params: summaryRequest(row, w.company.name, deps.model) });
      byId.set(id, row);
    }
  }
  const messages = await deps.runBatch(requests);
  for (const [id, row] of byId) {
    const message = messages.get(id);
    const parsed = message ? parseSummary(message) : null;
    if (parsed) {
      Object.assign(row, { ...parsed, model: message!.model });
      result.summarized++;
    } else {
      result.failed++; // stored without a summary; the next run retries it
    }
  }

  for (const w of work) {
    result.rows += await deps.replaceRows(w.company.id, w.fromYear, w.toYear, w.rows);
    const counts: Record<string, number> = {};
    for (const row of w.rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    result.pairs.push({ ticker: w.company.ticker, fromYear: w.fromYear, toYear: w.toYear, counts });
  }
  return result;
}
