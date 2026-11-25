/**
 * Two years of risks → rows for the risk_changes table. Pure, apart from
 * hashing. Summaries start empty; changes that only swap numbers (years,
 * note references) get a fixed summary and need no AI call.
 */
import { createHash } from "node:crypto";
import { diffStats, diffWords, onlyNumbersChanged, type DiffOp } from "./diff.ts";
import { matchRisks, type RiskChangeKind } from "./match.ts";
import type { Risk } from "./split.ts";

export type Materiality = "high" | "medium" | "low";

export interface RiskChangeRow {
  company_id: number;
  from_year: number;
  to_year: number;
  position: number;
  kind: RiskChangeKind;
  category: string | null;
  old_title: string | null;
  new_title: string | null;
  old_text: string | null;
  new_text: string | null;
  old_page: number | null;
  new_page: number | null;
  similarity: number | null;
  diff: DiffOp[];
  words_added: number;
  words_removed: number;
  numbers_only: boolean;
  change_key: string;
  summary: string | null;
  materiality: Materiality | null;
  model: string | null;
}

export const NUMBERS_ONLY_SUMMARY = "Only numbers such as years or note references were updated.";

const full = (r: Risk | null) => (r ? `${r.title}\n${r.body}` : "");

/** Same change → same key, so a re-run can reuse its summary. */
export function changeKey(kind: RiskChangeKind, oldFull: string, newFull: string): string {
  return createHash("sha256").update(`${kind}\u0000${oldFull}\u0000${newFull}`).digest("hex").slice(0, 32);
}

export function buildChangeRows(companyId: number, fromYear: number, toYear: number, oldRisks: readonly Risk[], newRisks: readonly Risk[]): RiskChangeRow[] {
  return matchRisks(oldRisks, newRisks).map((pair, position) => {
    const ops = pair.kind === "unchanged" ? [{ op: "equal" as const, text: full(pair.new) }] : diffWords(full(pair.old), full(pair.new));
    const stats = diffStats(ops);
    const numbersOnly = pair.kind === "modified" && onlyNumbersChanged(ops);
    return {
      company_id: companyId,
      from_year: fromYear,
      to_year: toYear,
      position,
      kind: pair.kind,
      category: pair.new?.category ?? pair.old?.category ?? null,
      old_title: pair.old?.title ?? null,
      new_title: pair.new?.title ?? null,
      old_text: pair.old?.body ?? null,
      new_text: pair.new?.body ?? null,
      old_page: pair.old?.page ?? null,
      new_page: pair.new?.page ?? null,
      similarity: pair.similarity === null ? null : Math.round(pair.similarity * 1000) / 1000,
      // Unchanged risks keep no diff: the text is already in new_text.
      diff: pair.kind === "unchanged" ? [] : ops,
      words_added: stats.wordsAdded,
      words_removed: pair.kind === "unchanged" ? 0 : stats.wordsRemoved,
      numbers_only: numbersOnly,
      change_key: changeKey(pair.kind, full(pair.old), full(pair.new)),
      summary: numbersOnly ? NUMBERS_ONLY_SUMMARY : null,
      materiality: numbersOnly ? "low" : null,
      model: null,
    };
  });
}

/** Added, removed and substantively modified risks get an AI summary; unchanged and numbers-only ones don't. */
export function needsSummary(row: RiskChangeRow): boolean {
  return row.summary === null && row.kind !== "unchanged" && !row.numbers_only;
}
