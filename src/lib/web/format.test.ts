import { describe, expect, it } from "vitest";
import { formatMetric, formatMoney, formatMonthDay } from "./format.ts";

describe("formatMoney", () => {
  it("scales dollars to billions and millions", () => {
    expect(formatMoney(681_000_000_000, "USD")).toBe("$681.0B");
    expect(formatMoney(-1_234_000, "USD")).toBe("−$1.2M");
    expect(formatMoney(950, "USD")).toBe("$950");
  });
  it("shows per-share values to the cent and share counts in billions", () => {
    expect(formatMoney(2.41, "USD/shares")).toBe("$2.41");
    expect(formatMoney(8_060_000_000, "shares")).toBe("8.06B shares");
  });
  it("keeps other units plain", () => {
    expect(formatMoney(2_100_000, "pure")).toBe("2,100,000 pure");
    expect(formatMoney(-0.5, "pure")).toBe("−0.5 pure");
  });
});

describe("formatMetric", () => {
  it("formats each metric unit", () => {
    expect(formatMetric(0.245, "fraction")).toBe("24.5%");
    expect(formatMetric(-0.031, "fraction")).toBe("−3.1%");
    expect(formatMetric(0.08, "percentage_points")).toBe("+8.0 pts");
    expect(formatMetric(-0.021, "percentage_points")).toBe("−2.1 pts");
    expect(formatMetric(8.24, "times")).toBe("8.2×");
    expect(formatMetric(44.4, "days")).toBe("44 days");
    expect(formatMetric(0.834, "ratio")).toBe("0.83");
  });
});

describe("formatMonthDay", () => {
  it("spells out the stored fiscal year end", () => {
    expect(formatMonthDay("01-31")).toBe("January 31");
    expect(formatMonthDay("08-03")).toBe("August 3");
    expect(formatMonthDay("13-01")).toBe("13-01");
  });
});
