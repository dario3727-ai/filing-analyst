import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/**
 * Real 10-Ks saved by `npm run fixtures:save` (gzip-compressed, byte-identical
 * to what the SEC sent). One per test-set company, latest fiscal year.
 */
export const FILING_FIXTURES = [
  { ticker: "WMT", fiscalYear: 2025 },
  { ticker: "TGT", fiscalYear: 2025 },
  { ticker: "COST", fiscalYear: 2025 },
  { ticker: "KR", fiscalYear: 2025 },
  { ticker: "GAP", fiscalYear: 2025 },
  { ticker: "FIVE", fiscalYear: 2025 },
  { ticker: "ADBE", fiscalYear: 2025 },
] as const;

/** The fixture's raw bytes, unzipped. */
export function loadFilingBytes(ticker: string, fiscalYear: number): Uint8Array {
  const file = new URL(`./fixtures/filings/${ticker.toLowerCase()}-${fiscalYear}.htm.gz`, import.meta.url);
  return new Uint8Array(gunzipSync(readFileSync(file)));
}
