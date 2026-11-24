import { describe, expect, it } from "vitest";
import { resolveInput, type Fact } from "@/metrics/resolve";
import type { InputDef } from "@/metrics/types";

const revenue: InputDef = {
  id: "revenue",
  label: "Revenue",
  kind: "duration",
  unit: "USD",
  tags: [{ tag: "us-gaap:Revenues" }, { tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" }],
};
const cogs: InputDef = {
  id: "cost_of_sales",
  label: "Cost of sales",
  kind: "duration",
  unit: "USD",
  tags: [{ tag: "us-gaap:CostOfRevenue" }, { tag: "us-gaap:CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization", note: "excludes depreciation" }],
};
const inventory: InputDef = { id: "inventory", label: "Inventory", kind: "instant", unit: "USD", tags: [{ tag: "us-gaap:InventoryNet" }] };

const fact = (over: Partial<Fact>): Fact => ({
  concept: "us-gaap:Revenues",
  unit: "USD",
  periodStart: "2025-02-01",
  periodEnd: "2026-01-31",
  fiscalYear: 2025,
  value: 100,
  ...over,
});

describe("resolveInput", () => {
  it("uses the first tag in the list when present (Walmart: total revenue, not contract revenue)", () => {
    const facts = [
      fact({ concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", value: 706_413 }),
      fact({ concept: "us-gaap:Revenues", value: 713_163 }),
    ];
    expect(resolveInput(facts, revenue, 2025)).toEqual({
      value: 713_163,
      tag: "us-gaap:Revenues",
      periodStart: "2025-02-01",
      periodEnd: "2026-01-31",
    });
  });

  it("falls back to the next tag (Target, Kroger: contract revenue only)", () => {
    const facts = [fact({ concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", value: 106_566 })];
    expect(resolveInput(facts, revenue, 2025)?.tag).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
  });

  it("carries the tag's note (Kroger's cost of sales)", () => {
    const facts = [fact({ concept: "us-gaap:CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization", value: 1 })];
    expect(resolveInput(facts, cogs, 2025)).toMatchObject({ note: "excludes depreciation" });
  });

  it("only matches the requested fiscal year", () => {
    expect(resolveInput([fact({ fiscalYear: 2024 })], revenue, 2025)).toBeUndefined();
  });

  it("ignores facts in the wrong unit", () => {
    expect(resolveInput([fact({ unit: "USD/shares" })], revenue, 2025)).toBeUndefined();
  });

  it("matches durations for flows and point-in-time facts for balances", () => {
    expect(resolveInput([fact({ periodStart: null })], revenue, 2025)).toBeUndefined();
    const balance = fact({ concept: "us-gaap:InventoryNet", periodStart: null, value: 56_435 });
    expect(resolveInput([balance], inventory, 2025)?.value).toBe(56_435);
    expect(resolveInput([fact({ concept: "us-gaap:InventoryNet" })], inventory, 2025)).toBeUndefined();
  });

  it("returns undefined when no tag has a value (Kroger inventory)", () => {
    expect(resolveInput([], inventory, 2025)).toBeUndefined();
  });
});
