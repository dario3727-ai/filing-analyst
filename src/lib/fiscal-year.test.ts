import { describe, expect, it } from "vitest";
import { fiscalYearLabel, formatFiscalYearEnd, parseIsoDate } from "@/lib/fiscal-year";

describe("fiscalYearLabel: test-set companies (period end only, as in filings)", () => {
  it.each([
    ["Walmart, ends Jan 31 2026", "2026-01-31", 2025],
    ["Target 53-week year, ends Feb 3 2024", "2024-02-03", 2023],
    ["Target, ends Feb 1 2025", "2025-02-01", 2024],
    ["Costco, ends Aug 30 2026", "2026-08-30", 2026],
    ["Costco 53-week year, ends Sep 3 2023", "2023-09-03", 2023],
    ["Adobe, ends Nov 28 2025", "2025-11-28", 2025],
    ["Adobe 53-week year, ends Dec 1 2023", "2023-12-01", 2023],
  ])("%s → %i", (_label, end, expected) => {
    expect(fiscalYearLabel(end)).toBe(expected);
  });
});

describe("fiscalYearLabel: edge cases", () => {
  it("labels a 52/53-week year ending in the first days of January with the earlier year", () => {
    expect(fiscalYearLabel("2027-01-02")).toBe(2026);
  });

  it("labels a calendar year with that year", () => {
    expect(fiscalYearLabel("2025-12-31")).toBe(2025);
    expect(fiscalYearLabel("2025-12-31", "2025-01-01")).toBe(2025);
  });

  it("labels a June 30 year end with the earlier year (184 days vs 181)", () => {
    expect(fiscalYearLabel("2026-06-30")).toBe(2025);
  });

  it("uses the real period when the start date is known (XBRL facts)", () => {
    // Walmart's fiscal year Feb 1 2023 – Jan 31 2024, as reported in three different 10-Ks.
    expect(fiscalYearLabel("2024-01-31", "2023-02-01")).toBe(2023);
  });

  it("handles a leap year in the window", () => {
    expect(fiscalYearLabel("2024-02-29")).toBe(2023);
  });

  it("rejects an end before the start", () => {
    expect(() => fiscalYearLabel("2024-01-31", "2024-02-01")).toThrow(/after end/);
  });
});

describe("parseIsoDate", () => {
  it("parses a valid date as UTC", () => {
    expect(parseIsoDate("2026-01-31").toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
  it.each(["2026-02-30", "2026-13-01", "26-01-31", "2026/01/31", ""])("rejects %j", (bad) => {
    expect(() => parseIsoDate(bad)).toThrow(/Invalid date/);
  });
});

describe("formatFiscalYearEnd", () => {
  it("turns MMDD into MM-DD", () => {
    expect(formatFiscalYearEnd("0131")).toBe("01-31");
    expect(formatFiscalYearEnd("1127")).toBe("11-27");
  });
  it.each(["131", "1331", "0100", "abcd"])("rejects %j", (bad) => {
    expect(() => formatFiscalYearEnd(bad)).toThrow(/Invalid fiscal year end/);
  });
});
