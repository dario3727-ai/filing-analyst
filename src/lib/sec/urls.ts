/**
 * Builders for the SEC addresses this project uses, plus a check that a URL
 * points at the SEC. The client refuses any other host, so the User-Agent
 * (which contains a contact email) is only ever sent to the SEC.
 *
 * Library code under src/lib uses relative imports ending in .ts so that
 * scripts run directly by Node (which doesn't know the "@/" shortcut) can
 * import it too.
 */
import { padCik } from "./cik.ts";

export const SEC_HOSTS: readonly string[] = ["data.sec.gov", "www.sec.gov"];

/** Company details and the list of filings. */
export function submissionsUrl(cik: string | number): string {
  return `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
}

/**
 * An older page of a company's filing list. The submissions file only holds
 * about the last 1,000 filings; earlier ones are in pages named like
 * CIK0000104169-submissions-001.json (listed in filings.files).
 */
export function submissionsPageUrl(pageName: string): string {
  if (!/^CIK\d{10}-submissions-\d{3}\.json$/.test(pageName)) {
    throw new Error(`Invalid submissions page name "${pageName}"`);
  }
  return `https://data.sec.gov/submissions/${pageName}`;
}

/** Ticker → CIK lookup table for every SEC-registered company. */
export const COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

/** Every XBRL-tagged fact the company has reported, all years. */
export function companyFactsUrl(cik: string | number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
}

/**
 * A document inside a filing, e.g. the 10-K HTML.
 * Archive paths use the CIK without leading zeros and the accession number
 * without dashes: 0000104169-26-000010 → 000010416926000010.
 */
export function filingDocumentUrl(cik: string | number, accessionNumber: string, document: string): string {
  const accession = accessionNumber.trim();
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) && !/^\d{18}$/.test(accession)) {
    throw new Error(`Invalid accession number "${accessionNumber}"`);
  }
  if (document === "" || document.includes("/") || document.includes("\\") || document.includes("..")) {
    throw new Error(`Invalid document name "${document}"`);
  }
  const cikNoZeros = String(Number(padCik(cik)));
  return `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${accession.replaceAll("-", "")}/${encodeURIComponent(document)}`;
}

/** True only for https URLs on an SEC host. */
export function isSecUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && SEC_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}
