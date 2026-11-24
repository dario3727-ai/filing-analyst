/**
 * Company search for the landing page. The list is small (only companies
 * already ingested), so matching happens in the browser on every keystroke.
 */

export interface CompanyOption {
  ticker: string;
  name: string;
  /** Downloaded 10-K years the slider may offer (latest unbroken run). */
  years: number[];
}

/**
 * Best matches first: exact ticker, ticker prefix, name prefix, a word in the
 * name starting with the query, then the query anywhere in the name.
 */
export function matchCompanies<T extends CompanyOption>(companies: readonly T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const scored: { company: T; score: number }[] = [];
  for (const company of companies) {
    const ticker = company.ticker.toLowerCase();
    const name = company.name.toLowerCase();
    let score: number | undefined;
    if (ticker === q) score = 0;
    else if (ticker.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (name.split(/[^a-z0-9]+/).some((word) => word.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 4;
    if (score !== undefined) scored.push({ company, score });
  }
  scored.sort((a, b) => a.score - b.score || a.company.ticker.localeCompare(b.company.ticker));
  return scored.slice(0, limit).map((s) => s.company);
}

/** The company the query names exactly (ticker or full name, any case), if any. */
export function exactCompany<T extends CompanyOption>(companies: readonly T[], query: string): T | undefined {
  const q = query.trim().toLowerCase();
  return companies.find((c) => c.ticker.toLowerCase() === q || c.name.toLowerCase() === q);
}
