/**
 * Turns stored rows (facts, ratios, red flags) into the tables the results
 * page shows: one row per input or metric, one column per fiscal year.
 * Pure: the page fetches rows, these functions arrange them.
 */
import { resolveInput, type Fact, type ResolvedValue } from "../../metrics/resolve.ts";
import type { MetricUnit, SectorProfile } from "../../metrics/types.ts";
import { formatMetric } from "./format.ts";

export interface RatioRow {
  fiscal_year: number;
  metric: string;
  status: string;
  value: number | null;
  reason: string | null;
  /** jsonb `{ values, notes }` written by the ratio engine. */
  inputs: unknown;
}

export interface RedFlagRow {
  fiscal_year: number;
  rule: string;
  detail: string;
  evidence: unknown;
}

/** Numbered notes shown under a table; the same text always gets the same number. */
export class Footnotes {
  private readonly numbers = new Map<string, number>();
  add(text: string): number {
    const existing = this.numbers.get(text);
    if (existing !== undefined) return existing;
    const n = this.numbers.size + 1;
    this.numbers.set(text, n);
    return n;
  }
  list(): { n: number; text: string }[] {
    return [...this.numbers].map(([text, n]) => ({ n, text }));
  }
}

export interface InputTableRow {
  id: string;
  label: string;
  unit: string;
  /** One per year, in column order; undefined = no fact for that year. */
  cells: (ResolvedValue | undefined)[];
  /** Distinct XBRL tags used across the years shown. */
  tags: string[];
  footnotes: number[];
}

/** Key financials: each profile input resolved for each year, with the tag used. */
export function buildInputTable(
  facts: readonly Fact[],
  profile: SectorProfile,
  years: readonly number[],
  notes: Footnotes,
): InputTableRow[] {
  return profile.inputs.map((input) => {
    const cells = years.map((y) => resolveInput(facts, input, y));
    const present = cells.filter((c): c is ResolvedValue => c !== undefined);
    const footnotes = [...new Set(present.flatMap((c) => (c.note ? [notes.add(c.note)] : [])))];
    return {
      id: input.id,
      label: input.label,
      unit: input.unit,
      cells,
      tags: [...new Set(present.map((c) => c.tag))],
      footnotes,
    };
  });
}

export interface RatioCell {
  /** "24.5%", "n/a", or "—" when no row exists for that year. */
  text: string;
  notApplicable: boolean;
  footnotes: number[];
}

export interface RatioTableRow {
  id: string;
  label: string;
  description: string;
  cells: RatioCell[];
}

/** `inputs.notes` from the jsonb column, ignoring anything malformed. */
export function readNotes(inputs: unknown): string[] {
  if (typeof inputs !== "object" || inputs === null || !("notes" in inputs)) return [];
  const notes = (inputs as { notes: unknown }).notes;
  return Array.isArray(notes) ? notes.filter((n): n is string => typeof n === "string") : [];
}

/** Ratios: profile metrics in profile order; reasons and notes become footnotes. */
export function buildRatioTable(
  ratios: readonly RatioRow[],
  profile: SectorProfile,
  years: readonly number[],
  notes: Footnotes,
): RatioTableRow[] {
  const byKey = new Map(ratios.map((r) => [`${r.metric}@${r.fiscal_year}`, r]));
  const known = new Set(profile.metrics.map((m) => m.id));
  const metrics: { id: string; label: string; description: string; unit: MetricUnit | undefined }[] = [
    ...profile.metrics.map((m) => ({ id: m.id, label: m.label, description: m.description, unit: m.unit })),
    // A stored metric the profile no longer defines: still shown, unformatted.
    ...[...new Set(ratios.map((r) => r.metric))]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, label: id, description: "Not in the current profile.", unit: undefined })),
  ];
  return metrics.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    cells: years.map((y): RatioCell => {
      const row = byKey.get(`${m.id}@${y}`);
      if (!row) return { text: "—", notApplicable: false, footnotes: [] };
      const footnotes = readNotes(row.inputs).map((n) => notes.add(n));
      if (row.status !== "ok" || row.value === null) {
        return { text: "n/a", notApplicable: true, footnotes: [notes.add(row.reason ?? "No reason recorded."), ...footnotes] };
      }
      const value = Number(row.value);
      return { text: m.unit ? formatMetric(value, m.unit) : String(value), notApplicable: false, footnotes };
    }),
  }));
}

export interface RedFlagView {
  fiscalYear: number;
  rule: string;
  label: string;
  detail: string;
  threshold: string;
}

/** Fired flags, newest year first, labeled from the profile's rule definitions. */
export function describeRedFlags(rows: readonly RedFlagRow[], profile: SectorProfile): RedFlagView[] {
  const rules = new Map(profile.redFlags.map((r) => [r.id, r]));
  return [...rows]
    .sort((a, b) => b.fiscal_year - a.fiscal_year || a.rule.localeCompare(b.rule))
    .map((row) => {
      const rule = rules.get(row.rule);
      return {
        fiscalYear: row.fiscal_year,
        rule: row.rule,
        label: rule?.label ?? row.rule,
        detail: row.detail,
        threshold: rule?.threshold ?? "Rule not in the current profile.",
      };
    });
}

/** Every XBRL concept any profile input could use, to mark facts the app already reads. */
export function profileTags(profile: SectorProfile): Set<string> {
  return new Set(profile.inputs.flatMap((i) => i.tags.map((t) => t.tag)));
}
