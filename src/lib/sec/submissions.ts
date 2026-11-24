/**
 * Turns the SEC submissions JSON (company details + filing list) into checked,
 * typed data, and picks the 10-Ks for a fiscal-year window.
 *
 * The SEC stores the filing list as parallel arrays ("columns"):
 *   { form: ["10-K", "4", ...], filingDate: ["2026-03-13", ...], ... }
 * where index i across all arrays is one filing. We turn that into one object
 * per filing. Anything not shaped as expected throws a clear error instead of
 * letting bad data reach the database.
 */
import { fiscalYearLabel } from "../fiscal-year.ts";

export interface FilingRecord {
  accessionNumber: string;
  filingDate: string;
  reportDate: string; // period end; "" for forms without one
  form: string;
  primaryDocument: string;
  isInlineXbrl: boolean;
}

export interface SubmissionsPageRef {
  name: string;
  filingFrom: string;
  filingTo: string;
}

export interface Submissions {
  cik: string;
  name: string;
  tickers: string[];
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null; // "MMDD"
  recent: FilingRecord[];
  olderPages: SubmissionsPageRef[];
}

export interface TenK {
  accessionNumber: string;
  fiscalYear: number;
  periodEnd: string;
  filedAt: string;
  primaryDocument: string;
}

// --- small shape checks ----------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") throw new Error(`${where}: "${key}" should be a non-empty string`);
  return value;
}

function optionalString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function requireArray(obj: Record<string, unknown>, key: string, where: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) throw new Error(`${where}: "${key}" should be an array`);
  return value;
}

// --- parsing -----------------------------------------------------------------

/** Parses the column-style filing list used by both `filings.recent` and older pages. */
export function parseFilingColumns(data: unknown, where: string): FilingRecord[] {
  if (!isRecord(data)) throw new Error(`${where}: expected an object of filing columns`);
  const accession = requireArray(data, "accessionNumber", where);
  const columns = {
    filingDate: requireArray(data, "filingDate", where),
    reportDate: requireArray(data, "reportDate", where),
    form: requireArray(data, "form", where),
    primaryDocument: requireArray(data, "primaryDocument", where),
    isInlineXBRL: requireArray(data, "isInlineXBRL", where),
  };
  for (const [name, column] of Object.entries(columns)) {
    if (column.length !== accession.length) {
      throw new Error(`${where}: column "${name}" has ${column.length} entries, expected ${accession.length}`);
    }
  }

  return accession.map((acc, i) => {
    const text = (column: unknown[], name: string): string => {
      const value = column[i];
      if (typeof value !== "string") throw new Error(`${where}: ${name}[${i}] should be a string`);
      return value;
    };
    return {
      accessionNumber: text(accession, "accessionNumber"),
      filingDate: text(columns.filingDate, "filingDate"),
      reportDate: text(columns.reportDate, "reportDate"),
      form: text(columns.form, "form"),
      primaryDocument: text(columns.primaryDocument, "primaryDocument"),
      isInlineXbrl: columns.isInlineXBRL[i] === 1,
    };
  });
}

export function parseSubmissions(data: unknown): Submissions {
  const where = "SEC submissions";
  if (!isRecord(data)) throw new Error(`${where}: expected a JSON object`);
  const filings = data.filings;
  if (!isRecord(filings)) throw new Error(`${where}: "filings" should be an object`);

  const tickers = requireArray(data, "tickers", where).filter((t): t is string => typeof t === "string");
  const files = Array.isArray(filings.files) ? filings.files : [];
  const olderPages = files.map((file, i) => {
    if (!isRecord(file)) throw new Error(`${where}: filings.files[${i}] should be an object`);
    const pageWhere = `${where} filings.files[${i}]`;
    return {
      name: requireString(file, "name", pageWhere),
      filingFrom: requireString(file, "filingFrom", pageWhere),
      filingTo: requireString(file, "filingTo", pageWhere),
    };
  });

  return {
    cik: requireString(data, "cik", where).padStart(10, "0"),
    name: requireString(data, "name", where),
    tickers,
    sic: optionalString(data, "sic"),
    sicDescription: optionalString(data, "sicDescription"),
    fiscalYearEnd: optionalString(data, "fiscalYearEnd"),
    recent: parseFilingColumns(filings.recent, `${where} filings.recent`),
    olderPages,
  };
}

// --- choosing what to load ---------------------------------------------------

/**
 * Older pages that might hold a 10-K for `fromYear` or later.
 * No pages are needed if the recent list already has a 10-K for `fromYear`
 * or earlier (older pages only hold older filings, so earlier fiscal years),
 * or if it reaches back past Jan 1 of `fromYear` (a 10-K for fiscal year Y
 * is filed after that year ends, so never before then).
 */
export function olderPagesNeeded(sub: Submissions, fromYear: number): string[] {
  const hasEarlyEnoughTenK = sub.recent.some(
    (f) => f.form === "10-K" && f.reportDate !== "" && fiscalYearLabel(f.reportDate) <= fromYear,
  );
  if (hasEarlyEnoughTenK) return [];
  const earliestUseful = `${fromYear}-01-01`;
  const oldestRecent = sub.recent.reduce((min, f) => (f.filingDate < min ? f.filingDate : min), "9999-12-31");
  if (oldestRecent <= earliestUseful) return [];
  return sub.olderPages.filter((page) => page.filingTo >= earliestUseful).map((page) => page.name);
}

/**
 * The original 10-Ks (not 10-K/A amendments) whose fiscal year falls in
 * [fromYear, toYear], one per fiscal year (the latest filed if there are
 * several), sorted oldest first.
 */
export function selectTenKs(filings: readonly FilingRecord[], fromYear: number, toYear: number): TenK[] {
  if (fromYear > toYear) throw new Error(`--from ${fromYear} is after --to ${toYear}`);
  const byYear = new Map<number, TenK>();
  for (const f of filings) {
    if (f.form !== "10-K" || f.reportDate === "" || f.primaryDocument === "") continue;
    const fiscalYear = fiscalYearLabel(f.reportDate);
    if (fiscalYear < fromYear || fiscalYear > toYear) continue;
    const candidate: TenK = {
      accessionNumber: f.accessionNumber,
      fiscalYear,
      periodEnd: f.reportDate,
      filedAt: f.filingDate,
      primaryDocument: f.primaryDocument,
    };
    const existing = byYear.get(fiscalYear);
    if (existing === undefined || candidate.filedAt > existing.filedAt) byYear.set(fiscalYear, candidate);
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
}
