import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCompanyFacts, selectAnnualFacts, type RawFact } from "@/lib/sec/companyfacts";

// Real Walmart company facts (3 concepts, every entry including 10-Qs), saved 2026-11-24.
const walmartJson: unknown = JSON.parse(
  readFileSync(new URL("../../../tests/fixtures/sec/companyfacts-wmt-trimmed.json", import.meta.url), "utf8"),
);
const parsed = parseCompanyFacts(walmartJson);
const result = selectAnnualFacts(parsed.facts, parsed.skipped);
const kept = (concept: string) => result.facts.filter((f) => f.concept === `us-gaap:${concept}`);
const keyOf = (f: { concept: string; unit: string; start?: string | null; periodStart?: string | null; end?: string; periodEnd?: string }) =>
  `${f.concept}|${f.unit}|${f.start ?? f.periodStart ?? ""}|${f.end ?? f.periodEnd}`;

describe("selectAnnualFacts on real Walmart data", () => {
  it("parses every entry in the fixture", () => {
    expect(parsed.skipped).toBe(0);
    expect(parsed.facts).toHaveLength(812);
  });

  it("keeps exactly one fact per concept, unit and period", () => {
    const keys = result.facts.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    expect(result.stats.reportedMoreThanOnce).toBeGreaterThan(0); // the duplicates were real
    expect(result.stats.unique).toBeLessThan(result.stats.annualReported);
  });

  it("keeps the most recently filed value for every period", () => {
    for (const fact of result.facts) {
      const sameKeyIn10K = parsed.facts.filter(
        (r) => (r.form === "10-K" || r.form === "10-K/A") && keyOf(r) === keyOf(fact),
      );
      const latestFiled = sameKeyIn10K.reduce((m, r) => (r.filed > m ? r.filed : m), "");
      expect(fact.filed).toBe(latestFiled);
    }
  });

  it("uses the restated cost of revenue for fiscal 2008 and records the restatement", () => {
    // First reported 2010-03-30 as $304,056M; restated in the 10-K filed 2011-03-30 as $303,941M.
    const fy2008 = kept("CostOfRevenue").find((f) => f.periodEnd === "2009-01-31");
    expect(fy2008).toMatchObject({ value: 303_941_000_000, filed: "2011-03-30", fiscalYear: 2008 });
    expect(result.restatements).toContainEqual(
      expect.objectContaining({
        concept: "us-gaap:CostOfRevenue",
        periodEnd: "2009-01-31",
        original: { value: 304_056_000_000, filed: "2010-03-30" },
        latest: { value: 303_941_000_000, filed: "2011-03-30" },
      }),
    );
  });

  it("keeps only ~annual durations: no quarterly cost of revenue", () => {
    for (const f of kept("CostOfRevenue")) {
      const days = (Date.parse(f.periodEnd) - Date.parse(f.periodStart ?? "")) / 86_400_000 + 1;
      expect(days).toBeGreaterThanOrEqual(350);
      expect(days).toBeLessThanOrEqual(380);
    }
  });

  it("keeps inventory only at fiscal year ends (late January), labeled with the most-days rule", () => {
    const inventory = kept("InventoryNet");
    expect(inventory.length).toBeGreaterThan(5);
    for (const f of inventory) {
      expect(f.periodStart).toBeNull();
      expect(f.periodEnd.slice(5, 7)).toBe("01"); // Walmart's year ends Jan 31
      expect(f.fiscalYear).toBe(Number(f.periodEnd.slice(0, 4)) - 1);
    }
  });

  it("keeps per-share values in their own unit", () => {
    expect(kept("EarningsPerShareDiluted").every((f) => f.unit === "USD/shares")).toBe(true);
  });

  it("labels Walmart's fiscal 2025 (Feb 2025 – Jan 2026) as 2025", () => {
    const fy2025 = kept("CostOfRevenue").find((f) => f.periodEnd === "2026-01-31");
    expect(fy2025?.fiscalYear).toBe(2025);
    expect(fy2025?.periodStart).toBe("2025-02-01");
  });
});

describe("selectAnnualFacts rules (synthetic facts)", () => {
  const fact = (over: Partial<RawFact>): RawFact => ({
    concept: "us-gaap:Revenues",
    unit: "USD",
    start: "2025-02-02",
    end: "2026-01-31",
    value: 100,
    accession: "0000000001-26-000001",
    form: "10-K",
    filed: "2026-03-13",
    ...over,
  });

  it("keeps a 53-week year (371 days)", () => {
    const { facts } = selectAnnualFacts([fact({ start: "2023-01-29", end: "2024-02-03" })]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.fiscalYear).toBe(2023);
  });

  it("drops quarterly durations and facts from other forms", () => {
    const { facts } = selectAnnualFacts([
      fact({ start: "2025-11-02", end: "2026-01-31" }), // a quarter inside a 10-K
      fact({ form: "10-Q" }),
      fact({ form: "8-K" }),
    ]);
    expect(facts).toEqual([]);
  });

  it("drops point-in-time values that aren't at a fiscal year end", () => {
    const { facts } = selectAnnualFacts([
      fact({}), // establishes 2026-01-31 as a fiscal year end
      fact({ concept: "us-gaap:InventoryNet", start: null, end: "2026-01-31" }),
      fact({ concept: "dei:EntityCommonStockSharesOutstanding", unit: "shares", start: null, end: "2026-03-06" }),
    ]);
    expect(facts.map((f) => f.concept).sort()).toEqual(["us-gaap:InventoryNet", "us-gaap:Revenues"]);
  });

  it("keeps 10-K/A amendments, and a later amendment wins", () => {
    const { facts, stats } = selectAnnualFacts([
      fact({ value: 100 }),
      fact({ value: 105, form: "10-K/A", filed: "2026-06-01", accession: "0000000001-26-000020" }),
    ]);
    expect(facts[0]?.value).toBe(105);
    expect(stats).toMatchObject({ reportedMoreThanOnce: 1, restated: 1 });
  });

  it("breaks a same-day tie by the higher accession number", () => {
    const { facts } = selectAnnualFacts([
      fact({ value: 1, accession: "0000000001-26-000002" }),
      fact({ value: 2, accession: "0000000001-26-000009" }),
    ]);
    expect(facts[0]?.value).toBe(2);
  });

  it("doesn't count identical repeats as restatements", () => {
    const { stats } = selectAnnualFacts([
      fact({}),
      fact({ filed: "2027-03-12", accession: "0000000001-27-000001" }),
    ]);
    expect(stats).toMatchObject({ reportedMoreThanOnce: 1, restated: 0, unique: 1 });
  });
});

describe("parseCompanyFacts", () => {
  it("skips malformed entries and counts them", () => {
    const { facts, skipped } = parseCompanyFacts({
      facts: {
        "us-gaap": {
          Revenues: {
            units: {
              USD: [
                { start: "2025-02-01", end: "2026-01-31", val: 1, accn: "a", form: "10-K", filed: "2026-03-13" },
                { end: "2026-01-31", val: "not a number", accn: "a", form: "10-K", filed: "2026-03-13" },
                { end: "Jan 31", val: 1, accn: "a", form: "10-K", filed: "2026-03-13" },
                "garbage",
              ],
            },
          },
        },
      },
    });
    expect(facts).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it("rejects a response without a facts object", () => {
    expect(() => parseCompanyFacts({ cik: 1 })).toThrow(/"facts" object/);
    expect(() => parseCompanyFacts(null)).toThrow(/"facts" object/);
  });
});
