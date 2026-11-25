/**
 * The company's reported XBRL figures as citable passages (decisions
 * 2026-11-25). The eval found that figures living only in the Item 8
 * statement tables (net income, inventory, buybacks, debt), which search
 * leaves out, made the app decline questions our own financial_facts table
 * answers exactly. One short passage per figure per fiscal year in the
 * range goes to Claude with the search results, so it can quote and cite
 * the reported number (CLAUDE.md: numbers come from XBRL, never the AI).
 * Pure; the figures are picked with the same profile and tag order as the
 * Key financials table.
 */
import { resolveInput, type Fact } from "../../metrics/resolve.ts";
import type { SectorProfile } from "../../metrics/types.ts";
import type { Passage } from "../search/hybrid.ts";

export const XBRL_ITEM = "XBRL";

/** Negative, so it never collides with a stored passage id; unique per fiscal year and figure. */
export function xbrlPassageId(fiscalYear: number, inputIndex: number): number {
  return -(fiscalYear * 100 + inputIndex + 1);
}

export function isXbrlPassage(p: { item: string }): boolean {
  return p.item === XBRL_ITEM;
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Exact, unambiguous amounts: "$21,901 million", "$3,876.5 million", "$2.73 per share", "−$12 million". */
export function formatReported(value: number, unit: string): string {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (unit === "USD/shares") return `${sign}$${abs.toFixed(2)} per share`;
  if (unit === "shares") return `${sign}${(abs / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })} million shares`;
  const millions = abs / 1e6;
  const digits = Number.isInteger(Math.round(millions * 10) / 10) ? 0 : 1;
  return `${sign}$${millions.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} million`;
}

export function buildXbrlPassages(facts: readonly Fact[], profile: SectorProfile, years: readonly number[], companyName: string): Passage[] {
  const passages: Passage[] = [];
  for (const year of years) {
    profile.inputs.forEach((input, i) => {
      const found = resolveInput(facts, input, year);
      if (!found) return;
      const when = input.kind === "instant" ? `at ${longDate(found.periodEnd)}` : `for the fiscal year ended ${longDate(found.periodEnd)}`;
      const note = found.note ? ` Note: ${found.note}.` : "";
      passages.push({
        id: xbrlPassageId(year, i),
        filingId: 0,
        fiscalYear: year,
        item: XBRL_ITEM,
        heading: input.label,
        kind: "xbrl",
        pageStart: 0,
        pageEnd: 0,
        content: `${companyName} reported ${input.label.toLowerCase()} ${when}: ${formatReported(found.value, input.unit)} (XBRL ${found.tag}).${note}`,
        semanticRank: null,
        keywordRank: null,
        score: 0,
      });
    });
  }
  return passages;
}
