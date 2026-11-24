import { describe, expect, it } from "vitest";
import { describeYears, parseYear, resolveRange, selectableYears, yearsInRange } from "./years.ts";

describe("selectableYears", () => {
  it("keeps only the latest unbroken run, so a gap can't be selected", () => {
    expect(selectableYears([2020, 2021, 2023, 2024])).toEqual([2023, 2024]);
  });
  it("sorts and de-duplicates", () => {
    expect(selectableYears([2025, 2023, 2024, 2024])).toEqual([2023, 2024, 2025]);
  });
  it("handles one year and none", () => {
    expect(selectableYears([2025])).toEqual([2025]);
    expect(selectableYears([])).toEqual([]);
  });
});

describe("parseYear", () => {
  it("accepts four digits only", () => {
    expect(parseYear("2024")).toBe(2024);
    expect(parseYear("24")).toBeUndefined();
    expect(parseYear("2024abc")).toBeUndefined();
    expect(parseYear(["2024"])).toBeUndefined();
    expect(parseYear(undefined)).toBeUndefined();
  });
});

describe("resolveRange", () => {
  const run = [2023, 2024, 2025];
  it("defaults to the whole run", () => {
    expect(resolveRange(run)).toEqual({ from: 2023, to: 2025 });
    expect(resolveRange(run, "junk", undefined)).toEqual({ from: 2023, to: 2025 });
  });
  it("keeps a valid range", () => {
    expect(resolveRange(run, "2024", "2024")).toEqual({ from: 2024, to: 2024 });
  });
  it("pulls out-of-range ends in and swaps reversed ends", () => {
    expect(resolveRange(run, "2010", "2030")).toEqual({ from: 2023, to: 2025 });
    expect(resolveRange(run, "2025", "2023")).toEqual({ from: 2023, to: 2025 });
  });
  it("returns null when nothing is downloaded", () => {
    expect(resolveRange([], "2023", "2025")).toBeNull();
  });
});

describe("yearsInRange and describeYears", () => {
  it("lists the years in a range", () => {
    expect(yearsInRange({ from: 2023, to: 2025 })).toEqual([2023, 2024, 2025]);
  });
  it("collapses runs", () => {
    expect(describeYears([2023, 2020, 2021])).toBe("2020–2021, 2023");
    expect(describeYears([2024])).toBe("2024");
    expect(describeYears([])).toBe("");
  });
});
