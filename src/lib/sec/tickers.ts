/**
 * Ticker → CIK lookup using the SEC's company_tickers.json, which looks like:
 *   { "0": { "cik_str": 104169, "ticker": "WMT", "title": "Walmart Inc." }, ... }
 */
import { padCik } from "./cik.ts";

export interface TickerEntry {
  cik: string; // 10 digits
  ticker: string;
  title: string;
}

export function parseCompanyTickers(data: unknown): Map<string, TickerEntry> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("SEC company tickers: expected a JSON object");
  }
  const byTicker = new Map<string, TickerEntry>();
  for (const entry of Object.values(data)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { cik_str: cik, ticker, title } = entry as Record<string, unknown>;
    if ((typeof cik !== "number" && typeof cik !== "string") || typeof ticker !== "string" || typeof title !== "string") {
      continue; // skip malformed rows rather than fail the whole lookup
    }
    byTicker.set(ticker.toUpperCase(), { cik: padCik(cik), ticker: ticker.toUpperCase(), title });
  }
  if (byTicker.size === 0) throw new Error("SEC company tickers: no usable entries");
  return byTicker;
}

export function findCompany(byTicker: ReadonlyMap<string, TickerEntry>, ticker: string): TickerEntry {
  const entry = byTicker.get(ticker.trim().toUpperCase());
  if (!entry) throw new Error(`Ticker "${ticker}" not found in the SEC's company list`);
  return entry;
}
