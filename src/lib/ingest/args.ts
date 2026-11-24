/**
 * Reads and checks the arguments of `npm run ingest -- --ticker WMT --from 2023 --to 2025`.
 * Uses Node's built-in parseArgs, so no dependency.
 */
import { parseArgs } from "node:util";

export interface IngestArgs {
  ticker: string;
  fromYear: number;
  toYear: number;
  /** Parse already-parsed filings again (after a parser change). */
  reparse?: boolean;
}

/** XBRL financial data on EDGAR starts around 2009. */
export const EARLIEST_YEAR = 2009;

export const USAGE = "Usage: npm run ingest -- --ticker <TICKER> --from <YEAR> --to <YEAR> [--reparse]";

function year(value: string | undefined, flag: string, latest: number): number {
  if (value === undefined) throw new Error(`Missing --${flag}. ${USAGE}`);
  if (!/^\d{4}$/.test(value)) throw new Error(`--${flag} must be a 4-digit year, got "${value}"`);
  const n = Number(value);
  if (n < EARLIEST_YEAR || n > latest) {
    throw new Error(`--${flag} must be between ${EARLIEST_YEAR} and ${latest}, got ${n}`);
  }
  return n;
}

/** `currentYear` is passed in (not read from the clock) so tests are stable. */
export function parseIngestArgs(argv: readonly string[], currentYear: number): IngestArgs {
  let values: { ticker?: string; from?: string; to?: string; reparse?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        ticker: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        reparse: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`${(error as Error).message}. ${USAGE}`);
  }

  const ticker = values.ticker?.trim().toUpperCase();
  if (!ticker) throw new Error(`Missing --ticker. ${USAGE}`);
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new Error(`--ticker "${values.ticker}" doesn't look like a ticker`);

  const fromYear = year(values.from, "from", currentYear);
  const toYear = year(values.to, "to", currentYear);
  if (fromYear > toYear) throw new Error(`--from ${fromYear} is after --to ${toYear}`);

  return { ticker, fromYear, toYear, reparse: values.reparse ?? false };
}
