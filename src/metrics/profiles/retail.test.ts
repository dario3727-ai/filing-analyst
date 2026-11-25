import { describe, expect, it } from "vitest";
import { allProfiles, getProfile } from "@/metrics/profiles";
import { retailProfile } from "@/metrics/profiles/retail";
import { valueKey, type MetricResult } from "@/metrics/types";

const metric = (id: string) => {
  const m = retailProfile.metrics.find((x) => x.id === id);
  if (!m) throw new Error(`no metric ${id}`);
  return m;
};
const value = (r: MetricResult) => ("value" in r ? r.value : undefined);
const reason = (r: MetricResult) => ("notApplicable" in r ? r.notApplicable : undefined);

describe("retail profile structure", () => {
  it("has the 12 agreed metrics", () => {
    expect(retailProfile.metrics.map((m) => m.id)).toEqual([
      "revenue_growth",
      "gross_margin",
      "operating_margin",
      "net_margin",
      "inventory_turnover",
      "days_inventory_outstanding",
      "current_ratio",
      "cash_conversion",
      "free_cash_flow_margin",
      "eps_diluted_growth",
      "return_on_assets",
      "receivables_growth_vs_revenue",
    ]);
  });

  it("uses unique input and metric ids", () => {
    const inputIds = retailProfile.inputs.map((i) => i.id);
    const metricIds = retailProfile.metrics.map((m) => m.id);
    expect(new Set(inputIds).size).toBe(inputIds.length);
    expect(new Set(metricIds).size).toBe(metricIds.length);
  });

  it("only requires inputs the profile defines, and uses every input not marked display-only", () => {
    const inputIds = new Set(retailProfile.inputs.map((i) => i.id));
    const used = new Set(retailProfile.metrics.flatMap((m) => m.requires.map((r) => r.input)));
    for (const id of used) expect(inputIds.has(id), `unknown input ${id}`).toBe(true);
    for (const input of retailProfile.inputs) {
      if (input.displayOnly) expect(used.has(input.id), `${input.id} is used by a metric; drop displayOnly`).toBe(false);
      else expect(used.has(input.id), `unused input ${input.id}`).toBe(true);
    }
  });

  it("lists at least one well-formed, non-repeated tag per input", () => {
    for (const input of retailProfile.inputs) {
      const tags = input.tags.map((t) => t.tag);
      expect(tags.length, input.id).toBeGreaterThan(0);
      expect(new Set(tags).size, input.id).toBe(tags.length);
      for (const tag of tags) expect(tag).toMatch(/^us-gaap:[A-Z][A-Za-z]+$/);
    }
  });

  it("puts total revenue first, and Kroger's depreciation-excluded cost of sales last with a note", () => {
    const revenue = retailProfile.inputs.find((i) => i.id === "revenue");
    const cogs = retailProfile.inputs.find((i) => i.id === "cost_of_sales");
    expect(revenue?.tags[0]?.tag).toBe("us-gaap:Revenues");
    expect(cogs?.tags.at(-1)).toMatchObject({
      tag: "us-gaap:CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization",
      note: expect.stringMatching(/excludes depreciation/),
    });
  });

  it("is registered by id; unprofiled companies get no profile", () => {
    expect(getProfile("retail")).toBe(retailProfile);
    expect(getProfile("unprofiled")).toBeUndefined();
    expect(allProfiles).toContain(retailProfile);
  });

  it("builds value keys for current and prior years", () => {
    expect(valueKey({ input: "revenue", year: "current" })).toBe("revenue");
    expect(valueKey({ input: "revenue", year: "prior" })).toBe("revenue@prior");
  });
});

describe("retail formulas (easy numbers)", () => {
  it("revenue growth: 110 vs 100 → +10%", () => {
    expect(value(metric("revenue_growth").compute({ revenue: 110, "revenue@prior": 100 }))).toBeCloseTo(0.1);
  });

  it("gross margin: revenue 200, cost of sales 150 → 25%", () => {
    expect(value(metric("gross_margin").compute({ revenue: 200, cost_of_sales: 150 }))).toBeCloseTo(0.25);
  });

  it("operating and net margin", () => {
    expect(value(metric("operating_margin").compute({ operating_income: 10, revenue: 200 }))).toBeCloseTo(0.05);
    expect(value(metric("net_margin").compute({ net_income: -4, revenue: 200 }))).toBeCloseTo(-0.02); // losses are fine
  });

  it("inventory turnover uses average inventory: 120 ÷ ((10 + 20) / 2) = 8×", () => {
    expect(value(metric("inventory_turnover").compute({ cost_of_sales: 120, inventory: 10, "inventory@prior": 20 }))).toBeCloseTo(8);
  });

  it("days inventory outstanding = 365 ÷ turnover", () => {
    const v = { cost_of_sales: 120, inventory: 10, "inventory@prior": 20 };
    expect(value(metric("days_inventory_outstanding").compute(v))).toBeCloseTo(365 / 8);
  });

  it("current ratio: 83 ÷ 100 = 0.83", () => {
    expect(value(metric("current_ratio").compute({ current_assets: 83, current_liabilities: 100 }))).toBeCloseTo(0.83);
  });

  it("cash conversion: 150 ÷ 100 = 1.5", () => {
    expect(value(metric("cash_conversion").compute({ operating_cash_flow: 150, net_income: 100 }))).toBeCloseTo(1.5);
  });

  it("free-cash-flow margin: (30 − 20) ÷ 200 = 5%", () => {
    expect(value(metric("free_cash_flow_margin").compute({ operating_cash_flow: 30, capex: 20, revenue: 200 }))).toBeCloseTo(0.05);
  });

  it("diluted EPS growth: 2.20 vs 2.00 → +10%", () => {
    expect(value(metric("eps_diluted_growth").compute({ eps_diluted: 2.2, "eps_diluted@prior": 2 }))).toBeCloseTo(0.1);
  });

  it("return on assets uses average assets: 9 ÷ ((80 + 100) / 2) = 10%", () => {
    expect(value(metric("return_on_assets").compute({ net_income: 9, total_assets: 80, "total_assets@prior": 100 }))).toBeCloseTo(0.1);
  });

  it("receivables growth vs revenue: +20% vs +5% → +15 points", () => {
    const v = { receivables: 120, "receivables@prior": 100, revenue: 105, "revenue@prior": 100 };
    expect(value(metric("receivables_growth_vs_revenue").compute(v))).toBeCloseTo(0.15);
  });
});

describe("retail formulas: not applicable instead of nonsense", () => {
  it.each([
    ["gross_margin", { revenue: 0, cost_of_sales: 10 }, /Revenue is zero or negative/],
    ["revenue_growth", { revenue: 10, "revenue@prior": 0 }, /Prior-year revenue/],
    ["inventory_turnover", { cost_of_sales: 10, inventory: 0, "inventory@prior": 0 }, /Average inventory/],
    ["days_inventory_outstanding", { cost_of_sales: 0, inventory: 5, "inventory@prior": 5 }, /Cost of sales/],
    ["current_ratio", { current_assets: 10, current_liabilities: 0 }, /Current liabilities/],
    ["cash_conversion", { operating_cash_flow: 10, net_income: -5 }, /Net income is zero or negative/],
    ["eps_diluted_growth", { eps_diluted: 1, "eps_diluted@prior": -0.5 }, /Prior-year diluted EPS/],
    ["return_on_assets", { net_income: 1, total_assets: 0, "total_assets@prior": 0 }, /Average total assets/],
    [
      "receivables_growth_vs_revenue",
      { receivables: 5, "receivables@prior": 0, revenue: 10, "revenue@prior": 9 },
      /Prior-year receivables/,
    ],
  ])("%s → not applicable", (id, values, message) => {
    expect(reason(metric(id).compute(values))).toMatch(message);
  });

  it("refuses to compute when a required value is missing (the engine must check first)", () => {
    expect(() => metric("gross_margin").compute({ revenue: 100 })).toThrow(/without "cost_of_sales"/);
  });
});
