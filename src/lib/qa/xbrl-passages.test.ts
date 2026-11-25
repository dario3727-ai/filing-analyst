import { describe, expect, it } from "vitest";
import { retailProfile } from "../../metrics/profiles/retail.ts";
import type { Fact } from "../../metrics/resolve.ts";
import { buildXbrlPassages, formatReported, isXbrlPassage, xbrlPassageId } from "./xbrl-passages.ts";

// Synthetic facts, not a real company's.
const facts: Fact[] = [
  { concept: "us-gaap:NetIncomeLoss", unit: "USD", value: 3_705_000_000, periodStart: "2025-02-02", periodEnd: "2026-01-31", fiscalYear: 2025 },
  { concept: "us-gaap:InventoryNet", unit: "USD", value: 12_345_600_000, periodStart: null, periodEnd: "2026-01-31", fiscalYear: 2025 },
  { concept: "us-gaap:EarningsPerShareDiluted", unit: "USD/shares", value: 8.13, periodStart: "2025-02-02", periodEnd: "2026-01-31", fiscalYear: 2025 },
  { concept: "us-gaap:NetIncomeLoss", unit: "USD", value: 4_091_000_000, periodStart: "2024-02-04", periodEnd: "2025-02-01", fiscalYear: 2024 },
];

describe("formatReported", () => {
  it("writes exact, unambiguous amounts", () => {
    expect(formatReported(21_901_000_000, "USD")).toBe("$21,901 million");
    expect(formatReported(3_876_527_000, "USD")).toBe("$3,876.5 million");
    expect(formatReported(-12_000_000, "USD")).toBe("−$12 million");
    expect(formatReported(2.731, "USD/shares")).toBe("$2.73 per share");
  });
});

describe("buildXbrlPassages", () => {
  const passages = buildXbrlPassages(facts, retailProfile, [2025], "Target");
  it("makes one citable passage per reported figure in the range, in profile order", () => {
    expect(passages.map((p) => p.heading)).toEqual(["Net income", "Diluted earnings per share", "Inventory"]);
    expect(passages[0]).toMatchObject({
      fiscalYear: 2025,
      item: "XBRL",
      kind: "xbrl",
      content: "Target reported net income for the fiscal year ended January 31, 2026: $3,705 million (XBRL us-gaap:NetIncomeLoss).",
    });
    expect(passages[2]!.content).toBe("Target reported inventory at January 31, 2026: $12,345.6 million (XBRL us-gaap:InventoryNet).");
    expect(passages.every(isXbrlPassage)).toBe(true);
  });
  it("only includes the years asked about, with ids that never collide with stored passages", () => {
    expect(passages.some((p) => p.fiscalYear === 2024)).toBe(false);
    const both = buildXbrlPassages(facts, retailProfile, [2024, 2025], "Target");
    const ids = both.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id < 0)).toBe(true);
    expect(xbrlPassageId(2025, 0)).not.toBe(xbrlPassageId(2024, 0));
  });
  it("returns nothing when no figures are stored", () => {
    expect(buildXbrlPassages([], retailProfile, [2025], "Target")).toEqual([]);
  });
});
