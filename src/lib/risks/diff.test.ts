import { describe, expect, it } from "vitest";
import { diffStats, diffWords, edits, onlyNumbersChanged } from "./diff.ts";

describe("diffWords", () => {
  it("finds a word-level rewording exactly (the 'could require' → 'has required' case)", () => {
    const ops = diffWords(
      "Changes in trade policy could require us to raise prices.",
      "Changes in trade policy have required us to raise prices.",
    );
    expect(ops).toEqual([
      { op: "equal", text: "Changes in trade policy" },
      { op: "delete", text: "could require" },
      { op: "insert", text: "have required" },
      { op: "equal", text: "us to raise prices." },
    ]);
    expect(edits(ops)).toEqual([{ before: "could require", after: "have required" }]);
    expect(diffStats(ops)).toEqual({ wordsAdded: 2, wordsRemoved: 2, wordsKept: 8 });
  });

  it("handles added and removed sentences, and identical text", () => {
    const added = diffWords("Tariffs raise costs.", "Tariffs raise costs. The Supreme Court ruled in 2026.");
    expect(edits(added)).toEqual([{ before: "", after: "The Supreme Court ruled in 2026." }]);
    const removed = diffWords("COVID-19 disrupted stores. Tariffs raise costs.", "Tariffs raise costs.");
    expect(edits(removed)).toEqual([{ before: "COVID-19 disrupted stores.", after: "" }]);
    expect(diffWords("Same text.", "Same text.")).toEqual([{ op: "equal", text: "Same text." }]);
  });

  it("treats huge rewrites as a full replacement instead of building a giant table", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join(" ");
    expect(diffWords(a, b).map((o) => o.op)).toEqual(["delete", "insert"]);
  });
});

describe("onlyNumbersChanged", () => {
  it("is true when only years or references changed", () => {
    expect(onlyNumbersChanged(diffWords("In fiscal 2024, see Note 20.", "In fiscal 2025, see Note 22."))).toBe(true);
    expect(onlyNumbersChanged(diffWords("Tariffs could raise costs.", "Tariffs have raised costs."))).toBe(false);
    expect(onlyNumbersChanged(diffWords("Same.", "Same."))).toBe(false);
  });
});
