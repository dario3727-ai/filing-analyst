/**
 * Shapes for sector profiles. A profile is mostly data: which inputs a sector
 * needs, which XBRL tags to try for each (in order), and which metrics to
 * compute from them. The ratio engine reads a profile; it never hardcodes
 * sector assumptions such as "inventory always exists".
 */

/** A duration covers a year (revenue); an instant is a balance-sheet date (inventory). */
export type PeriodKind = "duration" | "instant";
export type FactUnit = "USD" | "USD/shares" | "shares";

export interface TagOption {
  /** e.g. "us-gaap:Revenues" */
  tag: string;
  /** Shown next to any ratio that used this tag, e.g. a comparability caveat. */
  note?: string;
}

export interface InputDef {
  id: string;
  label: string;
  kind: PeriodKind;
  unit: FactUnit;
  /** Tried in order; the first tag with a value for that fiscal year wins. */
  tags: readonly TagOption[];
}

/** How a metric's value should be read and displayed. Stored values are plain numbers. */
export type MetricUnit =
  | "fraction" // 0.245 → shown as 24.5%
  | "percentage_points" // difference between two fractions: 0.08 → shown as +8.0 pts
  | "times" // turnover: 8.2×
  | "days"
  | "ratio"; // e.g. current ratio 0.83

export type YearRef = "current" | "prior";

export interface InputRef {
  input: string;
  year: YearRef;
}

export type MetricResult = { value: number } | { notApplicable: string };

export interface MetricDef {
  id: string;
  label: string;
  /** Plain-language explanation, shown in the UI. */
  description: string;
  unit: MetricUnit;
  /** Every input value the formula needs; missing any → "not applicable" with the reason. */
  requires: readonly InputRef[];
  /**
   * Pure formula. `v` holds each required value, keyed "<input>" for the
   * current year and "<input>@prior" for the year before.
   */
  compute(v: Readonly<Record<string, number>>): MetricResult;
}

export interface SectorProfile {
  id: string;
  label: string;
  inputs: readonly InputDef[];
  metrics: readonly MetricDef[];
}

/** Key used in a metric's value map for an input reference. */
export function valueKey(ref: InputRef): string {
  return ref.year === "prior" ? `${ref.input}@prior` : ref.input;
}
