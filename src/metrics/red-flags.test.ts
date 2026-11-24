import { describe, expect, it } from "vitest";
import { computeRatios } from "@/metrics/engine";
import { RETAIL_THRESHOLDS, retailProfile } from "@/metrics/profiles/retail";
import { evaluateRedFlags } from "@/metrics/red-flags";
import type { Fact } from "@/metrics/resolve";

const rule = (id: string) => {
  const r = retailProfile.redFlags.find((x) => x.id === id);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};

describe("retail red-flag rules (easy numbers)", () => {
  it("has the five agreed rules, each with a written threshold", () => {
    expect(retailProfile.redFlags.map((r) => r.id)).toEqual([
      "inventory_outpaces_sales",
      "gross_margin_drop",
      "operating_margin_drop",
      "negative_free_cash_flow",
      "weak_cash_conversion",
    ]);
    for (const r of retailProfile.redFlags) expect(r.threshold.length).toBeGreaterThan(10);
  });

  it("only references inputs and metrics the profile defines", () => {
    const inputs = new Set(retailProfile.inputs.map((i) => i.id));
    const metrics = new Set(retailProfile.metrics.map((m) => m.id));
    for (const r of retailProfile.redFlags) {
      for (const ref of r.requires) {
        if ("input" in ref) expect(inputs.has(ref.input), `${r.id}: ${ref.input}`).toBe(true);
        else expect(metrics.has(ref.metric), `${r.id}: ${ref.metric}`).toBe(true);
      }
    }
  });

  it("inventory outpaces sales: +30% inventory vs +13% revenue fires (Target fiscal 2021 pattern)", () => {
    const out = rule("inventory_outpaces_sales").check({ inventory: 130, "inventory@prior": 100, revenue_growth: 0.13 });
    expect(out).toEqual({
      fired: true,
      detail: "Inventory +30.0% vs revenue +13.0% (+17.0 pts)",
      evidence: { inventory_growth: expect.closeTo(0.3), revenue_growth: 0.13, gap: expect.closeTo(0.17) },
    });
  });

  it("inventory outpaces sales: stays quiet at or below the 10-point gap", () => {
    expect(rule("inventory_outpaces_sales").check({ inventory: 120, "inventory@prior": 100, revenue_growth: 0.1 }).fired).toBe(false);
    expect(rule("inventory_outpaces_sales").check({ inventory: 90, "inventory@prior": 100, revenue_growth: -0.05 }).fired).toBe(false);
  });

  it("gross margin drop: 29.3% → 24.6% fires; a 2.0-point dip doesn't", () => {
    expect(rule("gross_margin_drop").check({ gross_margin: 0.246, "gross_margin@prior": 0.293 })).toMatchObject({
      fired: true,
      detail: "Gross margin 24.6% vs 29.3% the year before (−4.7 pts)",
    });
    expect(rule("gross_margin_drop").check({ gross_margin: 0.27, "gross_margin@prior": 0.29 }).fired).toBe(false);
  });

  it("writes negative margins with a minus sign (Gap fiscal 2022: −0.4%)", () => {
    expect(rule("operating_margin_drop").check({ operating_margin: -0.004, "operating_margin@prior": 0.049 })).toMatchObject({
      detail: "Operating margin −0.4% vs 4.9% the year before (−5.3 pts)",
    });
  });

  it("operating margin drop: fires below −2 points", () => {
    expect(rule("operating_margin_drop").check({ operating_margin: 0.03, "operating_margin@prior": 0.06 }).fired).toBe(true);
    expect(rule("operating_margin_drop").check({ operating_margin: 0.05, "operating_margin@prior": 0.06 }).fired).toBe(false);
  });

  it("negative free cash flow and weak cash conversion", () => {
    expect(rule("negative_free_cash_flow").check({ free_cash_flow_margin: -0.014 })).toMatchObject({
      fired: true,
      detail: "Free cash flow −1.4% of revenue",
    });
    expect(rule("negative_free_cash_flow").check({ free_cash_flow_margin: 0 }).fired).toBe(false);
    expect(rule("weak_cash_conversion").check({ cash_conversion: 0.85 })).toMatchObject({
      fired: true,
      detail: "Operating cash flow was 0.85× net income",
    });
    expect(rule("weak_cash_conversion").check({ cash_conversion: RETAIL_THRESHOLDS.cashConversionMin }).fired).toBe(false);
  });
});

/** Minimal facts for one fiscal year of a retailer. */
function year(fy: number, start: string, end: string, v: { rev: number; cogs: number; inv: number; opi?: number }): Fact[] {
  const flow = (concept: string, value: number): Fact => ({
    concept: `us-gaap:${concept}`,
    unit: "USD",
    periodStart: start,
    periodEnd: end,
    fiscalYear: fy,
    value,
  });
  return [
    flow("Revenues", v.rev),
    flow("CostOfRevenue", v.cogs),
    flow("OperatingIncomeLoss", v.opi ?? v.rev * 0.05),
    flow("NetIncomeLoss", v.rev * 0.03),
    flow("NetCashProvidedByUsedInOperatingActivities", v.rev * 0.06),
    flow("PaymentsToAcquirePropertyPlantAndEquipment", v.rev * 0.03),
    { concept: "us-gaap:InventoryNet", unit: "USD", periodStart: null, periodEnd: end, fiscalYear: fy, value: v.inv },
  ];
}

describe("evaluateRedFlags over several years", () => {
  // A Target-like story: inventory builds in year 2, margins collapse in year 3.
  const facts = [
    ...year(2020, "2020-02-02", "2021-01-30", { rev: 1000, cogs: 707, inv: 100 }),
    ...year(2021, "2021-01-31", "2022-01-29", { rev: 1133, cogs: 801, inv: 130 }),
    ...year(2022, "2022-01-30", "2023-01-28", { rev: 1166, cogs: 879, inv: 126, opi: 1166 * 0.01 }),
  ];
  const ratios = computeRatios(facts, retailProfile);
  const flags = evaluateRedFlags(facts, retailProfile, ratios);

  it("flags the inventory build-up in year 2, before the margin drop", () => {
    expect(flags.filter((f) => f.fiscalYear === 2021).map((f) => f.rule)).toEqual(["inventory_outpaces_sales"]);
  });

  it("flags the margin collapse in year 3", () => {
    expect(flags.filter((f) => f.fiscalYear === 2022).map((f) => f.rule)).toEqual(["gross_margin_drop", "operating_margin_drop"]);
  });

  it("never fires without the prior year (first year has no flags)", () => {
    expect(flags.some((f) => f.fiscalYear === 2020)).toBe(false);
  });

  it("doesn't fire inventory rules when inventory is missing (Kroger)", () => {
    const noInventory = facts.filter((f) => f.concept !== "us-gaap:InventoryNet");
    const r = evaluateRedFlags(noInventory, retailProfile, computeRatios(noInventory, retailProfile));
    expect(r.some((f) => f.rule === "inventory_outpaces_sales")).toBe(false);
    expect(r.some((f) => f.rule === "gross_margin_drop")).toBe(true); // other rules still work
  });

  it("carries notes from the metrics it used (53-week year)", () => {
    const longYear = [
      ...year(2022, "2022-01-30", "2023-01-28", { rev: 1000, cogs: 700, inv: 100 }),
      ...year(2023, "2023-01-29", "2024-02-03", { rev: 1020, cogs: 714, inv: 125 }), // 371 days
    ];
    const r = evaluateRedFlags(longYear, retailProfile, computeRatios(longYear, retailProfile));
    const inv = r.find((f) => f.rule === "inventory_outpaces_sales");
    expect(inv?.notes).toEqual([expect.stringMatching(/FY2023 had 53 weeks/)]);
  });

  it("returns nothing when there are no ratios", () => {
    expect(evaluateRedFlags([], retailProfile, [])).toEqual([]);
  });
});
