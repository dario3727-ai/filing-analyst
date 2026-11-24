import { describe, expect, it } from "vitest";
import { parseIngestArgs } from "@/lib/ingest/args";

const YEAR = 2026;

describe("parseIngestArgs", () => {
  it("reads ticker and window", () => {
    expect(parseIngestArgs(["--ticker", "wmt", "--from", "2023", "--to", "2025"], YEAR)).toEqual({
      ticker: "WMT",
      fromYear: 2023,
      toYear: 2025,
    });
  });

  it("accepts --flag=value form and a one-year window", () => {
    expect(parseIngestArgs(["--ticker=COST", "--from=2025", "--to=2025"], YEAR)).toEqual({
      ticker: "COST",
      fromYear: 2025,
      toYear: 2025,
    });
  });

  it.each([
    [["--from", "2023", "--to", "2025"], /Missing --ticker/],
    [["--ticker", "WMT", "--to", "2025"], /Missing --from/],
    [["--ticker", "WMT", "--from", "2023"], /Missing --to/],
    [["--ticker", "WMT", "--from", "2025", "--to", "2023"], /after --to/],
    [["--ticker", "WMT", "--from", "23", "--to", "2025"], /4-digit year/],
    [["--ticker", "WMT", "--from", "2005", "--to", "2025"], /between 2009 and 2026/],
    [["--ticker", "WMT", "--from", "2023", "--to", "2030"], /between 2009 and 2026/],
    [["--ticker", "W M T", "--from", "2023", "--to", "2025"], /doesn't look like a ticker/],
    [["--ticker", "WMT", "--from", "2023", "--to", "2025", "--yeas", "3"], /Unknown option/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseIngestArgs(argv, YEAR)).toThrow(message);
  });

  it("includes the usage line in errors", () => {
    expect(() => parseIngestArgs([], YEAR)).toThrow(/Usage: npm run ingest/);
  });
});
