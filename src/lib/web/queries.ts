/**
 * Database reads for the web pages. Runs on the server (Server Components)
 * with the publishable key, which RLS limits to reading; the secret key is
 * never used by the web app. No SEC or AI calls: pages only read what
 * `npm run ingest` already stored.
 *
 * supabase-js without generated types returns untyped rows, so each query
 * casts to a row interface matching its `select(...)`. Generating database
 * types is a later improvement.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Fact } from "../../metrics/resolve.ts";
import type { RatioRow, RedFlagRow } from "./report.ts";
import type { CompanyOption } from "./search.ts";
import { resolveRange, selectableYears, type YearRange } from "./years.ts";

/** Hard cap on paged fact reads: 10 pages × 1,000 rows. */
const FACT_PAGE_SIZE = 1000;
const MAX_FACT_PAGES = 10;

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL or publishable key missing (run npm run check:env)");
  return createClient(url, key, { auth: { persistSession: false } });
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Reading ${what} failed: ${result.error.message}`);
  return result.data;
}

/** Every ingested company with the years its slider offers. */
export async function listCompanies(): Promise<CompanyOption[]> {
  const rows = check(
    await db().from("companies").select("ticker, name, filings(fiscal_year, storage_path)").order("ticker"),
    "companies",
  ) as unknown as { ticker: string; name: string; filings: { fiscal_year: number; storage_path: string | null }[] }[];
  return rows.map((c) => ({
    ticker: c.ticker,
    name: c.name,
    years: selectableYears(c.filings.filter((f) => f.storage_path !== null).map((f) => f.fiscal_year)),
  }));
}

export interface CompanyRow {
  id: number;
  cik: string;
  ticker: string;
  name: string;
  sic_code: string | null;
  sector_profile: string;
  fiscal_year_end: string | null;
}

export interface FilingWithSections {
  id: number;
  accession_no: string;
  form: string;
  fiscal_year: number;
  period_end: string;
  filed_at: string;
  primary_document: string;
  storage_path: string | null;
  status: string;
  sections: { item: string; title: string; page_start: number; page_end: number; word_count: number }[];
  /** Passages stored for this filing (only counted for filings in the range). */
  passages: number | null;
}

export interface FactRow {
  concept: string;
  unit: string;
  value: number;
  period_start: string | null;
  period_end: string;
  fiscal_year: number;
  accession_no: string;
}

export interface ReportData {
  company: CompanyRow;
  /** Years the slider offers for this company. */
  selectable: number[];
  /** null when the company has no downloaded 10-K. */
  range: YearRange | null;
  filings: FilingWithSections[];
  /** Facts for the fiscal years in the range. */
  facts: FactRow[];
  ratios: RatioRow[];
  redFlags: RedFlagRow[];
  /** Earliest and latest fiscal year with any stored XBRL fact. */
  factYears: { first: number; last: number } | null;
  totalFacts: number;
}

/** Facts in the range, paged because the API returns at most 1,000 rows per request. */
async function factsInRange(client: SupabaseClient, companyId: number, range: YearRange): Promise<FactRow[]> {
  const all: FactRow[] = [];
  for (let page = 0; page < MAX_FACT_PAGES; page++) {
    const from = page * FACT_PAGE_SIZE;
    const rows = check(
      await client
        .from("financial_facts")
        .select("concept, unit, value, period_start, period_end, fiscal_year, accession_no")
        .eq("company_id", companyId)
        .gte("fiscal_year", range.from)
        .lte("fiscal_year", range.to)
        .order("id")
        .range(from, from + FACT_PAGE_SIZE - 1),
      "facts",
    ) as unknown as FactRow[];
    // numeric columns can arrive as strings; make them numbers once, here.
    all.push(...rows.map((r) => ({ ...r, value: Number(r.value) })));
    if (rows.length < FACT_PAGE_SIZE) return all;
  }
  throw new Error(`More than ${MAX_FACT_PAGES * FACT_PAGE_SIZE} facts in the range; raise the cap deliberately.`);
}

/** Everything the results page shows for one company and year range; null if the ticker isn't loaded. */
export async function loadReport(ticker: string, from: unknown, to: unknown): Promise<ReportData | null> {
  const client = db();
  const company = check(
    await client
      .from("companies")
      .select("id, cik, ticker, name, sic_code, sector_profile, fiscal_year_end")
      .eq("ticker", ticker.toUpperCase())
      .maybeSingle(),
    "company",
  ) as unknown as CompanyRow | null;
  if (!company) return null;

  const filingRows = check(
    await client
      .from("filings")
      .select(
        "id, accession_no, form, fiscal_year, period_end, filed_at, primary_document, storage_path, status, sections(item, title, page_start, page_end, word_count)",
      )
      .eq("company_id", company.id)
      .order("fiscal_year", { ascending: false }),
    "filings",
  ) as unknown as Omit<FilingWithSections, "passages">[];

  const selectable = selectableYears(filingRows.filter((f) => f.storage_path !== null).map((f) => f.fiscal_year));
  const range = resolveRange(selectable, from, to);

  const countFacts = client.from("financial_facts").select("id", { count: "exact", head: true }).eq("company_id", company.id);
  const yearEdge = (ascending: boolean) =>
    client.from("financial_facts").select("fiscal_year").eq("company_id", company.id).order("fiscal_year", { ascending }).limit(1);
  const countPassages = (filingId: number) =>
    client.from("chunks").select("id", { count: "exact", head: true }).eq("filing_id", filingId);

  const inRange = (f: { fiscal_year: number }) => range !== null && f.fiscal_year >= range.from && f.fiscal_year <= range.to;

  const [facts, ratios, redFlags, total, first, last, passages] = await Promise.all([
    range ? factsInRange(client, company.id, range) : Promise.resolve([]),
    range
      ? client
          .from("ratios")
          .select("fiscal_year, metric, status, value, reason, inputs")
          .eq("company_id", company.id)
          .gte("fiscal_year", range.from)
          .lte("fiscal_year", range.to)
          .then((r) => check(r, "ratios") as unknown as RatioRow[])
      : Promise.resolve([]),
    range
      ? client
          .from("red_flags")
          .select("fiscal_year, rule, detail, evidence")
          .eq("company_id", company.id)
          .gte("fiscal_year", range.from)
          .lte("fiscal_year", range.to)
          .then((r) => check(r, "red flags") as unknown as RedFlagRow[])
      : Promise.resolve([]),
    countFacts,
    yearEdge(true),
    yearEdge(false),
    Promise.all(filingRows.map((f) => (inRange(f) ? countPassages(f.id).then((r) => r.count ?? 0) : Promise.resolve(null)))),
  ]);

  const firstYear = (first.data as { fiscal_year: number }[] | null)?.[0]?.fiscal_year;
  const lastYear = (last.data as { fiscal_year: number }[] | null)?.[0]?.fiscal_year;

  return {
    company,
    selectable,
    range,
    filings: filingRows.map((f, i) => ({ ...f, passages: passages[i] ?? null })),
    facts,
    ratios: ratios.map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) })),
    redFlags,
    factYears: firstYear !== undefined && lastYear !== undefined ? { first: firstYear, last: lastYear } : null,
    totalFacts: total.count ?? 0,
  };
}

/** FactRow (database column names) → Fact (what the ratio engine's resolver reads). */
export function toFact(row: FactRow): Fact {
  return {
    concept: row.concept,
    unit: row.unit,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fiscalYear: row.fiscal_year,
    value: row.value,
  };
}
