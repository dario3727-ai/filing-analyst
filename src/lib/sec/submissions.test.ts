import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  olderPagesNeeded,
  parseFilingColumns,
  parseSubmissions,
  selectTenKs,
  type FilingRecord,
} from "@/lib/sec/submissions";

// Trimmed copies of real SEC responses, saved 2026-11-24.
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../tests/fixtures/sec/${name}`, import.meta.url), "utf8"));
const walmart = parseSubmissions(fixture("submissions-wmt.json"));
const costco = parseSubmissions(fixture("submissions-cost.json"));

describe("parseSubmissions on real data", () => {
  it("reads Walmart's company details", () => {
    expect(walmart.cik).toBe("0000104169");
    expect(walmart.name).toBe("Walmart Inc.");
    expect(walmart.tickers).toContain("WMT");
    expect(walmart.sic).toBe("5331");
    expect(walmart.fiscalYearEnd).toBe("0131");
  });

  it("turns the column arrays into one record per filing", () => {
    expect(walmart.recent.length).toBeGreaterThan(900);
    expect(walmart.recent.every((f) => /^\d{10}-\d{2}-\d{6}$/.test(f.accessionNumber))).toBe(true);
  });

  it("lists Walmart's older pages", () => {
    expect(walmart.olderPages.map((p) => p.name)).toContain("CIK0000104169-submissions-001.json");
  });
});

describe("selectTenKs on real data", () => {
  it("picks Walmart's 10-Ks for fiscal 2023–2025, labeled by the most-days rule", () => {
    expect(selectTenKs(walmart.recent, 2023, 2025)).toEqual([
      expect.objectContaining({ fiscalYear: 2023, periodEnd: "2024-01-31", primaryDocument: "wmt-20240131.htm" }),
      expect.objectContaining({ fiscalYear: 2024, periodEnd: "2025-01-31", primaryDocument: "wmt-20250131.htm" }),
      expect.objectContaining({ fiscalYear: 2025, periodEnd: "2026-01-31", primaryDocument: "wmt-20260131.htm" }),
    ]);
  });

  it("labels Costco's August year ends with the year they end in", () => {
    const tenKs = selectTenKs(costco.recent, 2023, 2026);
    expect(tenKs.map((t) => [t.fiscalYear, t.periodEnd])).toEqual([
      [2023, "2023-09-03"],
      [2024, "2024-09-01"],
      [2025, "2025-08-31"],
      [2026, "2026-08-30"],
    ]);
  });

  it("returns nothing for a window with no 10-Ks", () => {
    expect(selectTenKs(walmart.recent, 2030, 2031)).toEqual([]);
  });

  it("rejects --from after --to", () => {
    expect(() => selectTenKs(walmart.recent, 2025, 2023)).toThrow(/after --to/);
  });
});

describe("olderPagesNeeded", () => {
  it("needs Walmart's older page for a window starting in 2020 (recent only reaches 2023)", () => {
    expect(olderPagesNeeded(walmart, 2020)).toEqual(["CIK0000104169-submissions-001.json"]);
  });

  it("needs no older page when the recent list already covers the window", () => {
    expect(olderPagesNeeded(walmart, 2024)).toEqual([]);
    expect(olderPagesNeeded(costco, 2020)).toEqual([]);
  });

  it("needs no older page when recent already has the first year's 10-K, even if recent starts mid-year", () => {
    // Walmart's recent list starts 2023-06-22 but includes its fiscal-2023 10-K (filed 2024-03).
    expect(olderPagesNeeded(walmart, 2023)).toEqual([]);
    expect(olderPagesNeeded(walmart, 2022)).toEqual(["CIK0000104169-submissions-001.json"]);
  });
});

describe("selectTenKs rules (synthetic filings)", () => {
  const filing = (over: Partial<FilingRecord>): FilingRecord => ({
    accessionNumber: "0000000001-26-000001",
    filingDate: "2026-03-13",
    reportDate: "2026-01-31",
    form: "10-K",
    primaryDocument: "x.htm",
    isInlineXbrl: true,
    ...over,
  });

  it("ignores amendments and other forms", () => {
    const result = selectTenKs(
      [filing({ form: "10-K/A" }), filing({ form: "10-Q" }), filing({ form: "8-K", reportDate: "" })],
      2020,
      2030,
    );
    expect(result).toEqual([]);
  });

  it("keeps the latest filed 10-K when two cover the same fiscal year", () => {
    const result = selectTenKs(
      [
        filing({ accessionNumber: "0000000001-26-000001", filingDate: "2026-03-13" }),
        filing({ accessionNumber: "0000000001-26-000009", filingDate: "2026-04-02" }),
      ],
      2025,
      2025,
    );
    expect(result.map((t) => t.accessionNumber)).toEqual(["0000000001-26-000009"]);
  });
});

describe("parse errors (bad data never reaches the database)", () => {
  it("rejects something that isn't an object", () => {
    expect(() => parseSubmissions(null)).toThrow(/expected a JSON object/);
  });

  it("rejects a missing company name", () => {
    expect(() => parseSubmissions({ cik: "1", tickers: [], filings: { recent: {} } })).toThrow(/"name"/);
  });

  it("rejects filing columns of different lengths", () => {
    const columns = {
      accessionNumber: ["0000000001-26-000001", "0000000001-26-000002"],
      filingDate: ["2026-03-13"],
      reportDate: ["", ""],
      form: ["10-K", "4"],
      primaryDocument: ["a.htm", "b.xml"],
      isInlineXBRL: [1, 0],
    };
    expect(() => parseFilingColumns(columns, "test")).toThrow(/"filingDate" has 1 entries, expected 2/);
  });
});
