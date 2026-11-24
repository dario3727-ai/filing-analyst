/**
 * Picks the value of a profile input for one fiscal year from a company's
 * facts: the first tag in the input's list that has a matching fact
 * (right unit, right period kind, that fiscal year). Records which tag was
 * used and any note on it, so every ratio can show where its numbers came from.
 */
import type { InputDef } from "./types.ts";

/** The subset of a financial_facts row the resolver needs. */
export interface Fact {
  concept: string;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
  fiscalYear: number;
  value: number;
}

export interface ResolvedValue {
  value: number;
  tag: string;
  periodEnd: string;
  note?: string;
}

export function resolveInput(facts: readonly Fact[], input: InputDef, fiscalYear: number): ResolvedValue | undefined {
  for (const option of input.tags) {
    const matches = facts.filter(
      (f) =>
        f.concept === option.tag &&
        f.unit === input.unit &&
        f.fiscalYear === fiscalYear &&
        (input.kind === "duration" ? f.periodStart !== null : f.periodStart === null),
    );
    if (matches.length === 0) continue;
    // Normally one match; if two dates share a fiscal-year label, take the later one.
    const best = matches.reduce((a, b) => (b.periodEnd > a.periodEnd ? b : a));
    return {
      value: best.value,
      tag: option.tag,
      periodEnd: best.periodEnd,
      ...(option.note === undefined ? {} : { note: option.note }),
    };
  }
  return undefined;
}
