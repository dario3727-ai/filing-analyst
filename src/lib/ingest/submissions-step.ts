/**
 * Ingest step 1: SEC submissions → companies and filings.
 *   ticker → CIK (company_tickers.json) → submissions (+ older pages if the
 *   window needs them) → 10-Ks in the window → upsert company and filings.
 */
import type { SecClient } from "../sec/client.ts";
import { formatFiscalYearEnd } from "../fiscal-year.ts";
import { olderPagesNeeded, parseFilingColumns, parseSubmissions, selectTenKs, type TenK } from "../sec/submissions.ts";
import { findCompany, parseCompanyTickers } from "../sec/tickers.ts";
import { COMPANY_TICKERS_URL, submissionsPageUrl, submissionsUrl } from "../sec/urls.ts";
import type { IngestArgs } from "./args.ts";
import { sectorProfileForSic } from "./sector.ts";
import type { IngestStore } from "./store.ts";

/** Hard cap on older submissions pages fetched per company. */
export const MAX_OLDER_PAGES = 3;

export interface SubmissionsStepResult {
  companyId: number;
  cik: string;
  name: string;
  sectorProfile: string;
  tenKs: TenK[];
  olderPagesFetched: number;
  warnings: string[];
}

export async function ingestSubmissions(
  sec: SecClient,
  store: IngestStore,
  args: IngestArgs,
): Promise<SubmissionsStepResult> {
  const warnings: string[] = [];

  const company = findCompany(parseCompanyTickers(await sec.getJson(COMPANY_TICKERS_URL)), args.ticker);
  const submissions = parseSubmissions(await sec.getJson(submissionsUrl(company.cik)));

  const pages = olderPagesNeeded(submissions, args.fromYear);
  if (pages.length > MAX_OLDER_PAGES) {
    warnings.push(`Window needs ${pages.length} older filing pages; fetched only the newest ${MAX_OLDER_PAGES}`);
  }
  const filings = [...submissions.recent];
  for (const page of pages.slice(0, MAX_OLDER_PAGES)) {
    filings.push(...parseFilingColumns(await sec.getJson(submissionsPageUrl(page)), `SEC submissions page ${page}`));
  }

  const tenKs = selectTenKs(filings, args.fromYear, args.toYear);
  const missing: number[] = [];
  for (let y = args.fromYear; y <= args.toYear; y++) {
    if (!tenKs.some((t) => t.fiscalYear === y)) missing.push(y);
  }
  if (missing.length > 0) warnings.push(`No 10-K found for fiscal year(s) ${missing.join(", ")}`);

  const sectorProfile = sectorProfileForSic(submissions.sic);
  const companyId = await store.upsertCompany({
    cik: submissions.cik,
    ticker: company.ticker,
    name: submissions.name,
    sic_code: submissions.sic,
    sector_profile: sectorProfile,
    fiscal_year_end: submissions.fiscalYearEnd === null ? null : formatFiscalYearEnd(submissions.fiscalYearEnd),
  });

  await store.upsertFilings(
    tenKs.map((t) => ({
      company_id: companyId,
      accession_no: t.accessionNumber,
      form: "10-K",
      fiscal_year: t.fiscalYear,
      period_end: t.periodEnd,
      filed_at: t.filedAt,
      primary_document: t.primaryDocument,
    })),
  );

  return {
    companyId,
    cik: submissions.cik,
    name: submissions.name,
    sectorProfile,
    tenKs,
    olderPagesFetched: Math.min(pages.length, MAX_OLDER_PAGES),
    warnings,
  };
}
