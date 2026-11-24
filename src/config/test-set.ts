/**
 * The v1 test set (decision 2026-11-24): six retailers plus one non-retail
 * crash test. Used by `npm run ingest:test-set`.
 */
export interface TestSetCompany {
  ticker: string;
  name: string;
  slot: string;
  crashTest: boolean;
}

export const TEST_SET: readonly TestSetCompany[] = [
  { ticker: "WMT", name: "Walmart", slot: "Big box / general merchandise", crashTest: false },
  { ticker: "TGT", name: "Target", slot: "Big box / general merchandise", crashTest: false },
  { ticker: "COST", name: "Costco", slot: "Warehouse club", crashTest: false },
  { ticker: "KR", name: "Kroger", slot: "Grocery", crashTest: false },
  { ticker: "GAP", name: "Gap Inc.", slot: "Specialty apparel", crashTest: false },
  { ticker: "FIVE", name: "Five Below", slot: "Value / smaller retailer", crashTest: false },
  { ticker: "ADBE", name: "Adobe", slot: "Crash test (non-retail)", crashTest: true },
];

/** Default fiscal-year window while developing (2 years minimum; decision 2026-11-24). */
export const DEV_WINDOW = { fromYear: 2023, toYear: 2025 } as const;
