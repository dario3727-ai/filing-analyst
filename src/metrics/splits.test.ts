import { describe, expect, it } from "vitest";
import { classifyShareChange, describeSplit } from "@/metrics/splits";

describe("classifyShareChange (real share counts)", () => {
  it("detects Walmart's 3-for-1 split: 2.847B → 8.415B diluted shares (from financial_facts)", () => {
    // Share counts are Walmart's reported values; assets are synthetic, "roughly flat".
    const change = classifyShareChange(2_847_000_000, 8_415_000_000, 1_000, 1_010);
    expect(change).toMatchObject({ kind: "split", factor: 3 });
    expect(change.ratio).toBeCloseTo(2.956, 3);
  });

  it("treats a normal year of buybacks as no change (Walmart 2.868B → 2.847B)", () => {
    expect(classifyShareChange(2_868_000_000, 2_847_000_000).kind).toBe("none");
  });
});

describe("classifyShareChange (rules)", () => {
  it.each([
    [100, 200, 2],
    [100, 150, 1.5],
    [100, 395, 4],
    [100, 10, 0.1], // 1-for-10 reverse split
  ])("%i → %i shares is a clean split ×%s", (before, after, factor) => {
    expect(classifyShareChange(before, after)).toMatchObject({ kind: "split", factor });
  });

  it("calls a sharp change that isn't a clean factor unclear", () => {
    const change = classifyShareChange(100, 180);
    expect(change.kind).toBe("unclear");
    expect(change.kind === "unclear" && change.reason).toMatch(/×1\.80, not a clean split factor/);
  });

  it("calls a clean-looking jump unclear when total assets jumped too (a merger)", () => {
    const change = classifyShareChange(100, 200, 1_000, 2_100);
    expect(change.kind === "unclear" && change.reason).toMatch(/looks like a merger/);
  });

  it("handles missing or zero share counts", () => {
    expect(classifyShareChange(0, 100).kind).toBe("unclear");
  });
});

describe("describeSplit", () => {
  it.each([
    [3, "3-for-1"],
    [2, "2-for-1"],
    [1.5, "3-for-2"],
    [0.1, "1-for-10"],
    [0.5, "1-for-2"],
  ])("%s → %s", (factor, text) => {
    expect(describeSplit(factor)).toBe(text);
  });
});
