import { describe, expect, it } from "vitest";
import { DEV_WINDOW, TEST_SET } from "@/config/test-set";

describe("test set", () => {
  it("has six retailers and one crash test, with unique tickers", () => {
    expect(TEST_SET).toHaveLength(7);
    expect(TEST_SET.filter((c) => c.crashTest).map((c) => c.ticker)).toEqual(["ADBE"]);
    expect(new Set(TEST_SET.map((c) => c.ticker)).size).toBe(7);
  });

  it("uses a development window of at least two years", () => {
    expect(DEV_WINDOW.toYear - DEV_WINDOW.fromYear + 1).toBeGreaterThanOrEqual(2);
  });
});
