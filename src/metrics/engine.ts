/**
 * The ratio engine: a company's annual facts + a sector profile → one result
 * per metric per fiscal year. Pure: no database, no network.
 *
 * Rules (docs/decisions.md, 2026-11-24):
 *  - Missing input → "not applicable" naming what's missing; never a guess.
 *  - Every result keeps the values and tags it used, plus notes.
 *  - 53-week years: values as reported, with a note on metrics that compare
 *    years or mix a year's flow with a balance (margins don't need one).
 *  - Stock splits: per-share prior-year values are divided by a detected
 *    clean split factor, with a note; an unclear share jump → not applicable.
 *  - `appliedLabel` (crash test): a note on every result saying the profile
 *    was applied to a company outside its sector.
 */
import { parseIsoDate } from "../lib/fiscal-year.ts";
import { resolveInput, type Fact, type ResolvedValue } from "./resolve.ts";
import { classifyShareChange, describeSplit } from "./splits.ts";
import { valueKey, type InputDef, type MetricDef, type SectorProfile } from "./types.ts";

export interface UsedValue {
  value: number;
  tag: string;
  periodEnd: string;
  /** Present when the engine changed the reported value (e.g. split-adjusted). */
  adjustedValue?: number;
}

export interface RatioResult {
  fiscalYear: number;
  metric: string;
  status: "ok" | "not_applicable";
  value: number | null;
  reason: string | null;
  inputs: { values: Record<string, UsedValue>; notes: string[] };
}

export interface EngineOptions {
  /** Only these fiscal years; default: every year with any input. */
  years?: readonly number[];
  /** Set when a profile is applied outside its sector (Adobe crash test). */
  appliedLabel?: string;
}

/** Inputs the engine itself needs for split detection; not part of any profile. */
const DILUTED_SHARES: InputDef = {
  id: "diluted_shares",
  label: "Diluted share count",
  kind: "duration",
  unit: "shares",
  tags: [{ tag: "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding" }],
};
const TOTAL_ASSETS: InputDef = {
  id: "total_assets",
  label: "Total assets",
  kind: "instant",
  unit: "USD",
  tags: [{ tag: "us-gaap:Assets" }],
};

/** A fiscal year this long or longer is a 53-week year (371 days; 52 weeks is 364). */
const FIFTY_THREE_WEEK_DAYS = 369;

function periodDays(r: ResolvedValue): number | undefined {
  if (r.periodStart === null) return undefined;
  return (parseIsoDate(r.periodEnd).getTime() - parseIsoDate(r.periodStart).getTime()) / 86_400_000 + 1;
}

export function computeRatios(facts: readonly Fact[], profile: SectorProfile, options: EngineOptions = {}): RatioResult[] {
  const inputsById = new Map(profile.inputs.map((i) => [i.id, i]));

  // Resolve each input once per year.
  const cache = new Map<string, ResolvedValue | undefined>();
  const resolve = (input: InputDef, year: number): ResolvedValue | undefined => {
    const k = `${input.id}|${year}`;
    if (!cache.has(k)) cache.set(k, resolveInput(facts, input, year));
    return cache.get(k);
  };

  const allYears = [...new Set(facts.map((f) => f.fiscalYear))].sort((a, b) => a - b);
  const years = (options.years ?? allYears).filter((y) =>
    profile.inputs.some((input) => resolve(input, y) !== undefined),
  );

  /** Days in fiscal year y, from the first duration input that has a value. */
  const yearDays = (y: number): number | undefined => {
    for (const input of profile.inputs) {
      if (input.kind !== "duration") continue;
      const r = resolve(input, y);
      const days = r && periodDays(r);
      if (days !== undefined) return days;
    }
    return undefined;
  };
  const is53Weeks = (y: number) => (yearDays(y) ?? 0) >= FIFTY_THREE_WEEK_DAYS;

  const results: RatioResult[] = [];
  for (const year of years) {
    for (const metric of profile.metrics) {
      results.push(evaluate(metric, year));
    }
  }
  return results;

  function evaluate(metric: MetricDef, year: number): RatioResult {
    const notes: string[] = [];
    if (options.appliedLabel) notes.push(options.appliedLabel);
    const used: Record<string, UsedValue> = {};
    const values: Record<string, number> = {};
    const na = (reason: string): RatioResult => ({
      fiscalYear: year,
      metric: metric.id,
      status: "not_applicable",
      value: null,
      reason,
      inputs: { values: used, notes },
    });

    for (const ref of metric.requires) {
      const input = inputsById.get(ref.input);
      if (!input) return na(`Profile error: unknown input "${ref.input}"`);
      const y = ref.year === "prior" ? year - 1 : year;
      const r = resolve(input, y);
      if (!r) return na(`No ${input.label.toLowerCase()} reported for FY${y}`);
      const key = valueKey(ref);
      used[key] = { value: r.value, tag: r.tag, periodEnd: r.periodEnd };
      values[key] = r.value;
      if (r.note && !notes.includes(r.note)) notes.push(r.note);
    }

    // Stock splits: adjust prior-year per-share or share values.
    for (const ref of metric.requires) {
      const input = inputsById.get(ref.input);
      if (!input || ref.year !== "prior" || (input.unit !== "USD/shares" && input.unit !== "shares")) continue;
      const sharesPrior = resolve(DILUTED_SHARES, year - 1);
      const sharesNow = resolve(DILUTED_SHARES, year);
      if (!sharesPrior || !sharesNow) continue; // can't check; use as reported
      const change = classifyShareChange(
        sharesPrior.value,
        sharesNow.value,
        resolve(TOTAL_ASSETS, year - 1)?.value,
        resolve(TOTAL_ASSETS, year)?.value,
      );
      if (change.kind === "unclear") {
        return na(`Per-share values aren't comparable between FY${year - 1} and FY${year}: ${change.reason}`);
      }
      if (change.kind === "split") {
        const key = valueKey(ref);
        const reported = values[key] ?? 0;
        const adjusted = input.unit === "USD/shares" ? reported / change.factor : reported * change.factor;
        values[key] = adjusted;
        const entry = used[key];
        if (entry) entry.adjustedValue = adjusted;
        notes.push(
          `FY${year - 1} ${input.label.toLowerCase()} adjusted for a ${describeSplit(change.factor)} stock split ` +
            `(diluted shares changed ×${change.ratio.toFixed(2)})`,
        );
      }
    }

    // 53-week years: note when years are compared or a flow is set against a balance.
    const kinds = metric.requires.map((r) => ({ ref: r, kind: inputsById.get(r.input)?.kind }));
    const comparesYears = kinds.some((k) => k.kind === "duration" && k.ref.year === "prior");
    const mixesFlowAndBalance = kinds.some((k) => k.kind === "duration") && kinds.some((k) => k.kind === "instant");
    const longYears = [year, year - 1].filter((y) => (y === year || comparesYears) && is53Weeks(y));
    if ((comparesYears || mixesFlowAndBalance) && longYears.length > 0) {
      for (const y of longYears.sort()) {
        notes.push(
          comparesYears
            ? `FY${y} had 53 weeks, so comparisons with a 52-week year are distorted by about 2%`
            : `FY${y} had 53 weeks, so this year's flows are about 2% higher relative to balances`,
        );
      }
    }

    const result = metric.compute(values);
    if ("notApplicable" in result) return na(result.notApplicable);
    if (!Number.isFinite(result.value)) return na("Calculation produced an invalid number");
    return {
      fiscalYear: year,
      metric: metric.id,
      status: "ok",
      value: result.value,
      reason: null,
      inputs: { values: used, notes },
    };
  }
}
