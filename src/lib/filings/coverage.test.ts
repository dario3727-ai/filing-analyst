import { describe, expect, it } from "vitest";
import { summarizeCoverage, type FilingCoverageInput } from "@/lib/filings/coverage";

const ALL = ["1", "1A", "7", "7A", "8"];
const filing = (over: Partial<FilingCoverageInput>): FilingCoverageInput => ({
  ticker: "WMT",
  fiscalYear: 2025,
  status: "parsed",
  downloaded: true,
  items: ALL,
  ...over,
});

describe("summarizeCoverage", () => {
  it("reports 100% when every parsed filing has all five items", () => {
    const s = summarizeCoverage([filing({}), filing({ ticker: "TGT" })]);
    expect(s).toMatchObject({ parsed: 2, complete: 2, share: 1 });
    expect(s.filings.every((f) => f.state === "complete")).toBe(true);
  });

  it("names the missing items of a partial filing and counts them by item", () => {
    const s = summarizeCoverage([filing({}), filing({ ticker: "KR", items: ["1", "1A", "7", "8"] })]);
    expect(s).toMatchObject({ parsed: 2, complete: 1, share: 0.5 });
    expect(s.filings.find((f) => f.ticker === "KR")).toMatchObject({ state: "partial", missing: ["7A"] });
    expect(s.missingByItem).toEqual({ "1": 0, "1A": 0, "7": 0, "7A": 1, "8": 0 });
  });

  it("leaves filings that aren't downloaded or parsed out of the share", () => {
    const s = summarizeCoverage([
      filing({}),
      filing({ fiscalYear: 2020, status: "pending", downloaded: false, items: [] }),
      filing({ fiscalYear: 2024, status: "downloaded", items: [] }),
    ]);
    expect(s).toMatchObject({ parsed: 1, complete: 1, share: 1 });
    expect(s.filings.map((f) => f.state)).toEqual(["not_downloaded", "not_parsed", "complete"]);
  });

  it("returns no share when nothing is parsed yet", () => {
    expect(summarizeCoverage([]).share).toBeNull();
  });

  it("sorts by ticker, then fiscal year", () => {
    const s = summarizeCoverage([filing({ ticker: "WMT", fiscalYear: 2024 }), filing({ ticker: "ADBE" }), filing({ fiscalYear: 2023 })]);
    expect(s.filings.map((f) => `${f.ticker} ${f.fiscalYear}`)).toEqual(["ADBE 2025", "WMT 2023", "WMT 2024"]);
  });
});
