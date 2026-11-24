import { describe, expect, it } from "vitest";
import { computeRatios, type RatioResult } from "@/metrics/engine";
import { retailProfile } from "@/metrics/profiles/retail";
import type { Fact } from "@/metrics/resolve";

/** One fiscal year of facts for a made-up retailer; override or drop any concept. */
function year(
  fiscalYear: number,
  start: string,
  end: string,
  overrides: Record<string, number | null> = {},
): Fact[] {
  const flows: Record<string, number> = {
    Revenues: 1000,
    CostOfRevenue: 750,
    OperatingIncomeLoss: 50,
    NetIncomeLoss: 30,
    EarningsPerShareDiluted: 3,
    NetCashProvidedByUsedInOperatingActivities: 60,
    PaymentsToAcquirePropertyPlantAndEquipment: 25,
    WeightedAverageNumberOfDilutedSharesOutstanding: 10,
  };
  const balances: Record<string, number> = {
    InventoryNet: 100,
    ReceivablesNetCurrent: 40,
    AssetsCurrent: 200,
    LiabilitiesCurrent: 250,
    Assets: 600,
  };
  const facts: Fact[] = [];
  const add = (name: string, value: number, periodStart: string | null) => {
    const v = name in overrides ? overrides[name] : value;
    if (v === null || v === undefined) return;
    const unit =
      name === "EarningsPerShareDiluted" ? "USD/shares" : name.startsWith("WeightedAverage") ? "shares" : "USD";
    facts.push({ concept: `us-gaap:${name}`, unit, periodStart, periodEnd: end, fiscalYear, value: v });
  };
  for (const [name, value] of Object.entries(flows)) add(name, value, start);
  for (const [name, value] of Object.entries(balances)) add(name, value, null);
  for (const [name, value] of Object.entries(overrides)) {
    if (!(name in flows) && !(name in balances) && value !== null) add(name, value, start);
  }
  return facts;
}

const find = (results: RatioResult[], metric: string, fiscalYear: number) => {
  const r = results.find((x) => x.metric === metric && x.fiscalYear === fiscalYear);
  if (!r) throw new Error(`no result for ${metric} FY${fiscalYear}`);
  return r;
};

const FY2024 = (o = {}) => year(2024, "2024-02-04", "2025-02-01", o); // 364 days
const FY2025 = (o = {}) => year(2025, "2025-02-02", "2026-01-31", o); // 364 days

describe("computeRatios: a complete retailer", () => {
  const results = computeRatios([...FY2024(), ...FY2025({ Revenues: 1100, ReceivablesNetCurrent: 50 })], retailProfile);

  it("computes all 12 metrics for a year with a prior year", () => {
    const fy2025 = results.filter((r) => r.fiscalYear === 2025);
    expect(fy2025).toHaveLength(12);
    expect(fy2025.every((r) => r.status === "ok")).toBe(true);
  });

  it("gets the numbers right", () => {
    expect(find(results, "revenue_growth", 2025).value).toBeCloseTo(0.1);
    expect(find(results, "gross_margin", 2025).value).toBeCloseTo((1100 - 750) / 1100);
    expect(find(results, "inventory_turnover", 2025).value).toBeCloseTo(7.5);
    expect(find(results, "current_ratio", 2025).value).toBeCloseTo(0.8);
    expect(find(results, "receivables_growth_vs_revenue", 2025).value).toBeCloseTo(0.25 - 0.1);
  });

  it("marks growth metrics not applicable for the first year, naming what's missing", () => {
    const r = find(results, "revenue_growth", 2024);
    expect(r).toMatchObject({ status: "not_applicable", value: null, reason: "No revenue reported for FY2023" });
    expect(find(results, "gross_margin", 2024).status).toBe("ok");
  });

  it("records the values and tags each result used", () => {
    expect(find(results, "gross_margin", 2025).inputs.values).toEqual({
      revenue: { value: 1100, tag: "us-gaap:Revenues", periodEnd: "2026-01-31" },
      cost_of_sales: { value: 750, tag: "us-gaap:CostOfRevenue", periodEnd: "2026-01-31" },
    });
    expect(Object.keys(find(results, "inventory_turnover", 2025).inputs.values)).toEqual([
      "cost_of_sales",
      "inventory",
      "inventory@prior",
    ]);
  });

  it("never stores ok without a value or not applicable without a reason", () => {
    for (const r of results) {
      if (r.status === "ok") expect(r.value !== null && r.reason === null).toBe(true);
      else expect(r.value === null && typeof r.reason === "string").toBe(true);
    }
  });
});

describe("computeRatios: missing data never crashes and never guesses", () => {
  it("Kroger-style: no inventory → turnover and days not applicable, everything else computed", () => {
    const results = computeRatios([...FY2024({ InventoryNet: null }), ...FY2025({ InventoryNet: null })], retailProfile);
    expect(find(results, "inventory_turnover", 2025)).toMatchObject({
      status: "not_applicable",
      reason: "No inventory reported for FY2025",
    });
    expect(find(results, "days_inventory_outstanding", 2025).status).toBe("not_applicable");
    expect(find(results, "gross_margin", 2025).status).toBe("ok");
  });

  it("Target-style: no receivables → receivables growth vs revenue not applicable", () => {
    const results = computeRatios(
      [...FY2024({ ReceivablesNetCurrent: null }), ...FY2025({ ReceivablesNetCurrent: null })],
      retailProfile,
    );
    expect(find(results, "receivables_growth_vs_revenue", 2025).reason).toBe("No receivables reported for FY2025");
  });

  it("passes on a formula's own reason (net loss → cash conversion not applicable)", () => {
    const results = computeRatios(FY2025({ NetIncomeLoss: -5 }), retailProfile);
    expect(find(results, "cash_conversion", 2025).reason).toBe("Net income is zero or negative");
    expect(find(results, "net_margin", 2025).value).toBeCloseTo(-0.005);
  });

  it("returns nothing for a company with no usable facts", () => {
    expect(computeRatios([], retailProfile)).toEqual([]);
  });
});

describe("computeRatios: notes", () => {
  it("carries a tag's note onto the metrics that used it (Kroger cost of sales)", () => {
    const kroger = (f: Fact[]) =>
      f.map((x) =>
        x.concept === "us-gaap:CostOfRevenue"
          ? { ...x, concept: "us-gaap:CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization" }
          : x,
      );
    const results = computeRatios([...kroger(FY2024()), ...kroger(FY2025())], retailProfile);
    expect(find(results, "gross_margin", 2025).inputs.notes).toEqual([expect.stringMatching(/excludes depreciation/)]);
    expect(find(results, "net_margin", 2025).inputs.notes).toEqual([]);
  });

  it("notes 53-week years only where they distort the metric", () => {
    const fy2023 = year(2023, "2023-01-29", "2024-02-03"); // 371 days
    const fy2024 = FY2024();
    const results = computeRatios([...fy2023, ...fy2024], retailProfile);

    // Growth compares FY2024 with the 53-week FY2023.
    expect(find(results, "revenue_growth", 2024).inputs.notes).toEqual([
      "FY2023 had 53 weeks, so comparisons with a 52-week year are distorted by about 2%",
    ]);
    // Turnover sets a 53-week flow against balances.
    expect(find(results, "inventory_turnover", 2023).status).toBe("not_applicable"); // no FY2022 inventory
    expect(find(results, "current_ratio", 2023).inputs.notes).toEqual([]); // balances only
    expect(find(results, "gross_margin", 2023).inputs.notes).toEqual([]); // same-year flows cancel out
    expect(find(results, "inventory_turnover", 2024).inputs.notes).toEqual([]); // FY2024 is 52 weeks
  });

  it("notes a 53-week current year when a flow is set against balances", () => {
    const fy2022 = year(2022, "2022-01-30", "2023-01-28");
    const fy2023 = year(2023, "2023-01-29", "2024-02-03"); // 371 days
    const results = computeRatios([...fy2022, ...fy2023], retailProfile);
    expect(find(results, "inventory_turnover", 2023).inputs.notes).toEqual([
      "FY2023 had 53 weeks, so this year's flows are about 2% higher relative to balances",
    ]);
  });

  it("labels every result when a profile is applied outside its sector (Adobe crash test)", () => {
    const label = "Retail metrics applied to a non-retail company (crash test)";
    const results = computeRatios([...FY2024({ InventoryNet: null }), ...FY2025({ InventoryNet: null })], retailProfile, {
      appliedLabel: label,
    });
    expect(results.every((r) => r.inputs.notes[0] === label)).toBe(true);
    expect(find(results, "inventory_turnover", 2025).status).toBe("not_applicable");
  });
});

describe("computeRatios: stock splits", () => {
  // Walmart's reported diluted EPS and share counts around its February 2024 3-for-1 split.
  const fy2020 = year(2020, "2020-02-01", "2021-01-31", {
    EarningsPerShareDiluted: 4.75,
    WeightedAverageNumberOfDilutedSharesOutstanding: 2_847_000_000,
  });
  const fy2021 = year(2021, "2021-02-01", "2022-01-31", {
    EarningsPerShareDiluted: 1.62,
    WeightedAverageNumberOfDilutedSharesOutstanding: 8_415_000_000,
  });

  it("adjusts the prior year's EPS for a clean split and says so", () => {
    const r = find(computeRatios([...fy2020, ...fy2021], retailProfile), "eps_diluted_growth", 2021);
    expect(r.status).toBe("ok");
    expect(r.value).toBeCloseTo(1.62 / (4.75 / 3) - 1, 6); // +2.3%, not −66%
    expect(r.inputs.values["eps_diluted@prior"]).toMatchObject({ value: 4.75, adjustedValue: 4.75 / 3 });
    expect(r.inputs.notes).toEqual([expect.stringMatching(/FY2020 diluted earnings per share adjusted for a 3-for-1 stock split/)]);
  });

  it("marks EPS growth not applicable when the share jump isn't a clean split", () => {
    const odd = year(2021, "2021-02-01", "2022-01-31", {
      EarningsPerShareDiluted: 1.62,
      WeightedAverageNumberOfDilutedSharesOutstanding: 5_100_000_000, // ×1.79
    });
    const r = find(computeRatios([...fy2020, ...odd], retailProfile), "eps_diluted_growth", 2021);
    expect(r.status).toBe("not_applicable");
    expect(r.reason).toMatch(/aren't comparable between FY2020 and FY2021: share count changed ×1\.79/);
  });

  it("leaves EPS growth alone in a normal year", () => {
    const fy2022 = year(2022, "2022-02-01", "2023-01-31", {
      EarningsPerShareDiluted: 1.42,
      WeightedAverageNumberOfDilutedSharesOutstanding: 8_202_000_000,
    });
    const r = find(computeRatios([...fy2021, ...fy2022], retailProfile), "eps_diluted_growth", 2022);
    expect(r.value).toBeCloseTo(1.42 / 1.62 - 1);
    expect(r.inputs.notes).toEqual([]);
  });
});

describe("computeRatios: options", () => {
  it("limits results to the requested years", () => {
    const results = computeRatios([...FY2024(), ...FY2025()], retailProfile, { years: [2025] });
    expect(new Set(results.map((r) => r.fiscalYear))).toEqual(new Set([2025]));
  });
});
