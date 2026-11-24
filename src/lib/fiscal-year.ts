/**
 * Fiscal-year labels (decision 2026-11-24): a fiscal year is labeled with the
 * calendar year in which most of it falls, counted in days.
 *
 *   ends 2026-01-31 (Walmart, Target...)  → 2025  (Feb–Dec 2025 is 334 days)
 *   ends 2026-08-30 (Costco)              → 2026  (Jan–Aug 2026 is 242 days)
 *   ends 2025-11-28 (Adobe)               → 2025
 *   ends 2027-01-02 (52/53-week, "Saturday nearest Dec 31") → 2026
 *   ends 2026-06-30                       → 2025  (Jul–Dec 2025 has 184 days vs 181)
 *
 * Never use the SEC's `fy` field for this: it's the year of the filing that
 * reported a number, and a 10-K repeats earlier years under its own `fy`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" as a UTC date, rejecting impossible dates like 2026-02-30. */
export function parseIsoDate(value: string): Date {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Invalid date "${value}": expected YYYY-MM-DD`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`Invalid date "${value}": no such day`);
  }
  return date;
}

/**
 * Label for the fiscal year ending on `periodEnd`. If `periodStart` is known
 * (XBRL facts have it), the actual period is used; otherwise (filings only
 * give an end date) it's taken as the 12 months ending on `periodEnd`.
 */
export function fiscalYearLabel(periodEnd: string, periodStart?: string): number {
  const end = parseIsoDate(periodEnd);
  let start: Date;
  if (periodStart === undefined) {
    start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate() + 1));
  } else {
    start = parseIsoDate(periodStart);
    if (start > end) throw new Error(`Period start ${periodStart} is after end ${periodEnd}`);
  }

  const endYear = end.getUTCFullYear();
  const startYear = start.getUTCFullYear();
  if (startYear === endYear) return endYear;

  // Days from start through Dec 31 of the start year, vs Jan 1 through end.
  const firstJanOfEndYear = Date.UTC(endYear, 0, 1);
  const daysInStartYear = (firstJanOfEndYear - start.getTime()) / DAY_MS;
  const daysInEndYear = (end.getTime() - firstJanOfEndYear) / DAY_MS + 1;
  // On an exact tie, use the year the period ends.
  return daysInStartYear > daysInEndYear ? endYear - 1 : endYear;
}

/** The SEC gives fiscal year end as "MMDD" (e.g. "0131"); the database stores "MM-DD". */
export function formatFiscalYearEnd(mmdd: string): string {
  if (!/^\d{4}$/.test(mmdd)) throw new Error(`Invalid fiscal year end "${mmdd}": expected MMDD`);
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid fiscal year end "${mmdd}"`);
  }
  return `${mmdd.slice(0, 2)}-${mmdd.slice(2)}`;
}
