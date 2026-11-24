/**
 * Parser coverage: for each filing, which target items were found, and the
 * share of parsed filings where all of them were (milestone 2 "done when":
 * 100% for the retail test set, or each failure explained). Pure.
 */
import { TARGET_ITEMS } from "./sections.ts";

export interface FilingCoverageInput {
  ticker: string;
  fiscalYear: number;
  status: string;
  downloaded: boolean;
  items: readonly string[];
}

export interface FilingCoverage extends FilingCoverageInput {
  state: "complete" | "partial" | "not_parsed" | "not_downloaded";
  missing: string[];
}

export interface CoverageSummary {
  filings: FilingCoverage[];
  parsed: number;
  complete: number;
  /** complete ÷ parsed, or null when nothing is parsed yet. */
  share: number | null;
  /** How often each target item was missing among parsed filings. */
  missingByItem: Record<string, number>;
}

const PARSED = new Set(["parsed", "embedded"]);

export function summarizeCoverage(inputs: readonly FilingCoverageInput[]): CoverageSummary {
  const missingByItem: Record<string, number> = Object.fromEntries(TARGET_ITEMS.map((i) => [i, 0]));
  const filings = inputs
    .map((f): FilingCoverage => {
      if (!f.downloaded) return { ...f, state: "not_downloaded", missing: [] };
      if (!PARSED.has(f.status)) return { ...f, state: "not_parsed", missing: [] };
      const missing = TARGET_ITEMS.filter((item) => !f.items.includes(item));
      for (const item of missing) missingByItem[item] = (missingByItem[item] ?? 0) + 1;
      return { ...f, state: missing.length === 0 ? "complete" : "partial", missing };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.fiscalYear - b.fiscalYear);

  const parsed = filings.filter((f) => f.state === "complete" || f.state === "partial").length;
  const complete = filings.filter((f) => f.state === "complete").length;
  return { filings, parsed, complete, share: parsed === 0 ? null : complete / parsed, missingByItem };
}
