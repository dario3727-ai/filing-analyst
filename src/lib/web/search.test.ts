import { describe, expect, it } from "vitest";
import { exactCompany, matchCompanies } from "./search.ts";

const companies = [
  { ticker: "WMT", name: "Walmart Inc.", years: [2023, 2024, 2025] },
  { ticker: "TGT", name: "Target Corp", years: [2023, 2024, 2025] },
  { ticker: "GAP", name: "Gap Inc", years: [2025] },
  { ticker: "FIVE", name: "Five Below, Inc", years: [2025] },
];

describe("matchCompanies", () => {
  it("ranks an exact ticker first, then ticker prefixes, then names", () => {
    expect(matchCompanies(companies, "gap").map((c) => c.ticker)).toEqual(["GAP"]);
    // TGT by ticker prefix, then WMT because "t" appears inside "Walmart".
    expect(matchCompanies(companies, "t").map((c) => c.ticker)).toEqual(["TGT", "WMT"]);
    expect(matchCompanies(companies, "inc").map((c) => c.ticker)).toEqual(["FIVE", "GAP", "WMT"]);
  });
  it("matches a word inside the name", () => {
    expect(matchCompanies(companies, "below").map((c) => c.ticker)).toEqual(["FIVE"]);
  });
  it("is case-insensitive and ignores surrounding spaces", () => {
    expect(matchCompanies(companies, "  WALM ").map((c) => c.ticker)).toEqual(["WMT"]);
  });
  it("returns nothing for an empty query or no match", () => {
    expect(matchCompanies(companies, " ")).toEqual([]);
    expect(matchCompanies(companies, "apple")).toEqual([]);
  });
  it("respects the limit", () => {
    expect(matchCompanies(companies, "i", 2)).toHaveLength(2);
  });
});

describe("exactCompany", () => {
  it("finds by ticker or full name", () => {
    expect(exactCompany(companies, "wmt")?.ticker).toBe("WMT");
    expect(exactCompany(companies, "target corp")?.ticker).toBe("TGT");
    expect(exactCompany(companies, "targ")).toBeUndefined();
  });
});
