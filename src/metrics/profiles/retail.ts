/**
 * Retail sector profile (v1). Tag orders come from the test set's real XBRL
 * data, fiscal 2019–2025 (docs/decisions.md, 2026-11-24):
 *  - revenue: `Revenues` first because it's total revenue (Walmart's includes
 *    membership and other income; its contract-revenue tag is ~$6B lower).
 *  - receivables: Walmart's balance-sheet line is ReceivablesNetCurrent; its
 *    AccountsReceivableNet is only a component, so it comes last.
 *  - Target and Five Below report no receivables; Kroger reports no standard
 *    inventory tag. Those metrics come out "not applicable", not guessed.
 *  - Older years: fallbacks are added only when they equal the newer tag in
 *    an overlap year. Target's missing operating-income years are left
 *    alone: the only nearby tag is pre-tax income, a different number.
 *
 * Values are fractions (0.245 = 24.5%). Formulas are pure and never divide
 * by zero: a non-positive denominator gives "not applicable" with a reason.
 */
import type { InputDef, MetricDef, MetricResult, RedFlagRule, SectorProfile } from "../types.ts";

const usGaap = (name: string, note?: string) => (note ? { tag: `us-gaap:${name}`, note } : { tag: `us-gaap:${name}` });

const inputs: readonly InputDef[] = [
  {
    id: "revenue",
    label: "Revenue",
    kind: "duration",
    unit: "USD",
    tags: [
      usGaap("Revenues"),
      usGaap("RevenueFromContractWithCustomerExcludingAssessedTax"),
      usGaap("SalesRevenueNet"), // common before 2018
      usGaap("SalesRevenueGoodsNet"), // Kroger before 2016 (equals its later revenue tag in the overlap year)
      usGaap("RevenueFromContractWithCustomerIncludingAssessedTax"),
    ],
  },
  {
    id: "cost_of_sales",
    label: "Cost of sales",
    kind: "duration",
    unit: "USD",
    tags: [
      usGaap("CostOfRevenue"),
      usGaap("CostOfGoodsAndServicesSold"),
      usGaap("CostOfGoodsSold"), // common before 2018
      usGaap("CostOfMerchandiseSalesBuyingAndOccupancyCosts"), // Gap 2010–2016 (identical to its standard tag where both exist)
      usGaap(
        "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization",
        "Cost of sales excludes depreciation, so it isn't directly comparable with other retailers",
      ),
    ],
  },
  {
    id: "operating_income",
    label: "Operating income",
    kind: "duration",
    unit: "USD",
    tags: [usGaap("OperatingIncomeLoss")],
  },
  {
    id: "net_income",
    label: "Net income",
    kind: "duration",
    unit: "USD",
    tags: [
      usGaap("NetIncomeLoss"),
      usGaap("NetIncomeLossAvailableToCommonStockholdersBasic"), // Target, fiscal 2019
      usGaap("ProfitLoss", "Net income includes noncontrolling interests"),
    ],
  },
  {
    id: "eps_diluted",
    label: "Diluted earnings per share",
    kind: "duration",
    unit: "USD/shares",
    tags: [usGaap("EarningsPerShareDiluted")],
  },
  {
    id: "operating_cash_flow",
    label: "Operating cash flow",
    kind: "duration",
    unit: "USD",
    tags: [
      usGaap("NetCashProvidedByUsedInOperatingActivities"),
      usGaap("NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"),
    ],
  },
  {
    id: "capex",
    label: "Capital expenditures",
    kind: "duration",
    unit: "USD",
    tags: [
      usGaap("PaymentsToAcquirePropertyPlantAndEquipment"),
      usGaap("PaymentsToAcquireProductiveAssets", "Capital expenditures may include intangible assets"), // Kroger
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    kind: "instant",
    unit: "USD",
    tags: [
      usGaap("InventoryNet"),
      usGaap("InventoryFinishedGoodsNetOfReserves"), // Gap
      usGaap("RetailRelatedInventoryMerchandise"),
    ],
  },
  {
    id: "receivables",
    label: "Receivables",
    kind: "instant",
    unit: "USD",
    tags: [usGaap("AccountsReceivableNetCurrent"), usGaap("ReceivablesNetCurrent"), usGaap("AccountsReceivableNet")],
  },
  { id: "current_assets", label: "Current assets", kind: "instant", unit: "USD", tags: [usGaap("AssetsCurrent")] },
  {
    id: "current_liabilities",
    label: "Current liabilities",
    kind: "instant",
    unit: "USD",
    tags: [usGaap("LiabilitiesCurrent")],
  },
  { id: "total_assets", label: "Total assets", kind: "instant", unit: "USD", tags: [usGaap("Assets")] },
];

// --- formula helpers ----------------------------------------------------------

const na = (reason: string): MetricResult => ({ notApplicable: reason });

/** a ÷ b, or "not applicable" when b isn't positive. */
function divide(a: number, b: number, what: string): MetricResult {
  return b > 0 ? { value: a / b } : na(`${what} is zero or negative`);
}

/** (now − before) ÷ before; growth from a zero or negative base isn't meaningful. */
function growth(now: number, before: number, what: string): MetricResult {
  return before > 0 ? { value: (now - before) / before } : na(`Prior-year ${what} is zero or negative`);
}

function get(v: Readonly<Record<string, number>>, key: string): number {
  const value = v[key];
  // The engine only calls compute once every required value exists; this guards misuse.
  if (value === undefined) throw new Error(`Formula called without "${key}"`);
  return value;
}

// --- metrics ------------------------------------------------------------------

const metrics: readonly MetricDef[] = [
  {
    id: "revenue_growth",
    label: "Revenue growth",
    description: "Change in total revenue from the prior fiscal year.",
    unit: "fraction",
    requires: [
      { input: "revenue", year: "current" },
      { input: "revenue", year: "prior" },
    ],
    compute: (v) => growth(get(v, "revenue"), get(v, "revenue@prior"), "revenue"),
  },
  {
    id: "gross_margin",
    label: "Gross margin",
    description: "Share of revenue left after the cost of the goods sold: (revenue − cost of sales) ÷ revenue.",
    unit: "fraction",
    requires: [
      { input: "revenue", year: "current" },
      { input: "cost_of_sales", year: "current" },
    ],
    compute: (v) => divide(get(v, "revenue") - get(v, "cost_of_sales"), get(v, "revenue"), "Revenue"),
  },
  {
    id: "operating_margin",
    label: "Operating margin",
    description: "Operating income ÷ revenue: profit from running the business, before interest and taxes.",
    unit: "fraction",
    requires: [
      { input: "operating_income", year: "current" },
      { input: "revenue", year: "current" },
    ],
    compute: (v) => divide(get(v, "operating_income"), get(v, "revenue"), "Revenue"),
  },
  {
    id: "net_margin",
    label: "Net margin",
    description: "Net income ÷ revenue: the share of revenue kept as profit after all costs and taxes.",
    unit: "fraction",
    requires: [
      { input: "net_income", year: "current" },
      { input: "revenue", year: "current" },
    ],
    compute: (v) => divide(get(v, "net_income"), get(v, "revenue"), "Revenue"),
  },
  {
    id: "inventory_turnover",
    label: "Inventory turnover",
    description: "Cost of sales ÷ average inventory: how many times a year the store sells through its stock.",
    unit: "times",
    requires: [
      { input: "cost_of_sales", year: "current" },
      { input: "inventory", year: "current" },
      { input: "inventory", year: "prior" },
    ],
    compute: (v) =>
      divide(get(v, "cost_of_sales"), (get(v, "inventory") + get(v, "inventory@prior")) / 2, "Average inventory"),
  },
  {
    id: "days_inventory_outstanding",
    label: "Days inventory outstanding",
    description: "365 × average inventory ÷ cost of sales: roughly how many days goods sit before they sell.",
    unit: "days",
    requires: [
      { input: "cost_of_sales", year: "current" },
      { input: "inventory", year: "current" },
      { input: "inventory", year: "prior" },
    ],
    compute: (v) =>
      divide((365 * (get(v, "inventory") + get(v, "inventory@prior"))) / 2, get(v, "cost_of_sales"), "Cost of sales"),
  },
  {
    id: "current_ratio",
    label: "Current ratio",
    description: "Current assets ÷ current liabilities: ability to cover bills due within a year. Big retailers often run below 1.",
    unit: "ratio",
    requires: [
      { input: "current_assets", year: "current" },
      { input: "current_liabilities", year: "current" },
    ],
    compute: (v) => divide(get(v, "current_assets"), get(v, "current_liabilities"), "Current liabilities"),
  },
  {
    id: "cash_conversion",
    label: "Cash conversion",
    description: "Operating cash flow ÷ net income: how much of reported profit arrived as cash. Well below 1 can signal low-quality earnings.",
    unit: "ratio",
    requires: [
      { input: "operating_cash_flow", year: "current" },
      { input: "net_income", year: "current" },
    ],
    compute: (v) => divide(get(v, "operating_cash_flow"), get(v, "net_income"), "Net income"),
  },
  {
    id: "free_cash_flow_margin",
    label: "Free-cash-flow margin",
    description: "(Operating cash flow − capital expenditures) ÷ revenue: cash left after investing in stores and equipment.",
    unit: "fraction",
    requires: [
      { input: "operating_cash_flow", year: "current" },
      { input: "capex", year: "current" },
      { input: "revenue", year: "current" },
    ],
    compute: (v) => divide(get(v, "operating_cash_flow") - get(v, "capex"), get(v, "revenue"), "Revenue"),
  },
  {
    id: "eps_diluted_growth",
    label: "Diluted EPS growth",
    description: "Change in diluted earnings per share from the prior year (adjusted for stock splits by the ratio engine).",
    unit: "fraction",
    requires: [
      { input: "eps_diluted", year: "current" },
      { input: "eps_diluted", year: "prior" },
    ],
    compute: (v) => growth(get(v, "eps_diluted"), get(v, "eps_diluted@prior"), "diluted EPS"),
  },
  {
    id: "return_on_assets",
    label: "Return on assets",
    description: "Net income ÷ average total assets: profit earned on each dollar the company owns.",
    unit: "fraction",
    requires: [
      { input: "net_income", year: "current" },
      { input: "total_assets", year: "current" },
      { input: "total_assets", year: "prior" },
    ],
    compute: (v) =>
      divide(get(v, "net_income"), (get(v, "total_assets") + get(v, "total_assets@prior")) / 2, "Average total assets"),
  },
  {
    id: "receivables_growth_vs_revenue",
    label: "Receivables growth vs revenue",
    description: "Receivables growth minus revenue growth. Strongly positive means customers owe more relative to sales, a possible warning sign.",
    unit: "percentage_points",
    requires: [
      { input: "receivables", year: "current" },
      { input: "receivables", year: "prior" },
      { input: "revenue", year: "current" },
      { input: "revenue", year: "prior" },
    ],
    compute: (v) => {
      const ar = growth(get(v, "receivables"), get(v, "receivables@prior"), "receivables");
      const rev = growth(get(v, "revenue"), get(v, "revenue@prior"), "revenue");
      if ("notApplicable" in ar) return ar;
      if ("notApplicable" in rev) return rev;
      return { value: ar.value - rev.value };
    },
  },
];

// --- red flags ------------------------------------------------------------------
// Thresholds calibrated on the test set, fiscal 2015–2025 (66 retailer-years;
// decision 2026-11-24). A receivables rule was considered and left out: most
// retail sales are paid at the till, so receivables are small and noisy.

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pts`;
const share = (x: number) => `${x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(1)}%`;

/** Thresholds as named constants so the docs and tests can refer to them. */
export const RETAIL_THRESHOLDS = {
  inventoryGapPoints: 0.1,
  grossMarginDropPoints: 0.02,
  operatingMarginDropPoints: 0.02,
  cashConversionMin: 1.0,
} as const;

const redFlags: readonly RedFlagRule[] = [
  {
    id: "inventory_outpaces_sales",
    label: "Inventory growing faster than sales",
    description:
      "Unsold goods are piling up faster than sales are growing, which often leads to markdowns and lower margins the next year (Target and Walmart fiscal 2021, before Target's 2022 margin drop).",
    threshold: "inventory growth − revenue growth > 10 points",
    requires: [
      { input: "inventory", year: "current" },
      { input: "inventory", year: "prior" },
      // The metric rather than raw revenue, so its notes (53-week years) carry over.
      { metric: "revenue_growth", year: "current" },
    ],
    check: (v) => {
      const invPrior = get(v, "inventory@prior");
      if (invPrior <= 0) return { fired: false };
      const invGrowth = get(v, "inventory") / invPrior - 1;
      const revGrowth = get(v, "revenue_growth");
      const gap = invGrowth - revGrowth;
      if (gap <= RETAIL_THRESHOLDS.inventoryGapPoints) return { fired: false };
      return {
        fired: true,
        detail: `Inventory ${pct(invGrowth)} vs revenue ${pct(revGrowth)} (${pts(gap)})`,
        evidence: { inventory_growth: invGrowth, revenue_growth: revGrowth, gap },
      };
    },
  },
  {
    id: "gross_margin_drop",
    label: "Gross margin fell sharply",
    description:
      "The share of revenue left after the cost of goods fell by more than 2 points: markdowns, higher costs or a shift to lower-margin products.",
    threshold: "gross margin down more than 2 points from the prior year",
    requires: [
      { metric: "gross_margin", year: "current" },
      { metric: "gross_margin", year: "prior" },
    ],
    check: (v) => {
      const now = get(v, "gross_margin");
      const before = get(v, "gross_margin@prior");
      const change = now - before;
      if (change >= -RETAIL_THRESHOLDS.grossMarginDropPoints) return { fired: false };
      return {
        fired: true,
        detail: `Gross margin ${share(now)} vs ${share(before)} the year before (${pts(change)})`,
        evidence: { gross_margin: now, gross_margin_prior: before, change },
      };
    },
  },
  {
    id: "operating_margin_drop",
    label: "Operating margin fell sharply",
    description:
      "Profit from running the business fell by more than 2 points of revenue: costs grew faster than sales, or margins on goods fell.",
    threshold: "operating margin down more than 2 points from the prior year",
    requires: [
      { metric: "operating_margin", year: "current" },
      { metric: "operating_margin", year: "prior" },
    ],
    check: (v) => {
      const now = get(v, "operating_margin");
      const before = get(v, "operating_margin@prior");
      const change = now - before;
      if (change >= -RETAIL_THRESHOLDS.operatingMarginDropPoints) return { fired: false };
      return {
        fired: true,
        detail: `Operating margin ${share(now)} vs ${share(before)} the year before (${pts(change)})`,
        evidence: { operating_margin: now, operating_margin_prior: before, change },
      };
    },
  },
  {
    id: "negative_free_cash_flow",
    label: "Negative free cash flow",
    description:
      "Operating cash flow didn't cover spending on stores and equipment, so the gap was funded from cash or borrowing.",
    threshold: "free-cash-flow margin below 0",
    requires: [{ metric: "free_cash_flow_margin", year: "current" }],
    check: (v) => {
      const fcf = get(v, "free_cash_flow_margin");
      if (fcf >= 0) return { fired: false };
      return {
        fired: true,
        detail: `Free cash flow ${pct(fcf)} of revenue`,
        evidence: { free_cash_flow_margin: fcf },
      };
    },
  },
  {
    id: "weak_cash_conversion",
    label: "Profit not turning into cash",
    description:
      "Operating cash flow was below net income. Retailers normally sit well above 1 because depreciation is a non-cash cost, so this is unusual and worth reading about.",
    threshold: "operating cash flow ÷ net income below 1.0",
    requires: [{ metric: "cash_conversion", year: "current" }],
    check: (v) => {
      const cc = get(v, "cash_conversion");
      if (cc >= RETAIL_THRESHOLDS.cashConversionMin) return { fired: false };
      return {
        fired: true,
        detail: `Operating cash flow was ${cc.toFixed(2)}× net income`,
        evidence: { cash_conversion: cc },
      };
    },
  },
];

export const retailProfile: SectorProfile = {
  id: "retail",
  label: "Retail",
  inputs,
  metrics,
  redFlags,
};
