/**
 * Which fiscal years the year slider offers, and how a requested range from
 * the URL (?from=2023&to=2025) is turned into a valid one. Pure functions.
 *
 * Rule (decisions 2026-11-24): the slider covers only downloaded 10-K years,
 * and only the latest unbroken run of them, so a range with a missing year
 * (2020, 2021, 2023) can never be selected.
 */

export interface YearRange {
  from: number;
  to: number;
}

/** The latest unbroken run of years: [2020, 2021, 2023, 2024] → [2023, 2024]. */
export function selectableYears(downloaded: readonly number[]): number[] {
  const years = [...new Set(downloaded.filter(Number.isInteger))].sort((a, b) => a - b);
  const newest = years.at(-1);
  if (newest === undefined) return [];
  const run = [newest];
  for (let i = years.length - 2; i >= 0; i--) {
    const year = years[i];
    if (year === undefined || year !== run[0]! - 1) break;
    run.unshift(year);
  }
  return run;
}

/** "2023" → 2023; anything else (missing, "abc", "23", an array) → undefined. */
export function parseYear(value: unknown): number | undefined {
  return typeof value === "string" && /^\d{4}$/.test(value) ? Number(value) : undefined;
}

/**
 * A valid range inside the selectable years. Missing or invalid ends default
 * to the whole run; out-of-range ends are pulled in; reversed ends are swapped.
 * Returns null when nothing is selectable (no downloaded 10-Ks).
 */
export function resolveRange(selectable: readonly number[], from?: unknown, to?: unknown): YearRange | null {
  const min = selectable[0];
  const max = selectable.at(-1);
  if (min === undefined || max === undefined) return null;
  const clamp = (y: number) => Math.min(max, Math.max(min, y));
  const a = clamp(parseYear(from) ?? min);
  const b = clamp(parseYear(to) ?? max);
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** { from: 2023, to: 2025 } → [2023, 2024, 2025] */
export function yearsInRange(range: YearRange): number[] {
  const years: number[] = [];
  for (let y = range.from; y <= range.to; y++) years.push(y);
  return years;
}

/** [2020, 2021, 2023] → "2020–2021, 2023" (for listing years outside the slider). */
export function describeYears(years: readonly number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = start;
  for (const y of [...sorted.slice(1), undefined]) {
    if (y !== undefined && prev !== undefined && y === prev + 1) {
      prev = y;
      continue;
    }
    if (start !== undefined && prev !== undefined) parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = y;
    prev = y;
  }
  return parts.join(", ");
}
