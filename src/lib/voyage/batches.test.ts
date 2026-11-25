import { describe, expect, it } from "vitest";
import { embeddingText, planBatches } from "./batches.ts";

describe("embeddingText", () => {
  const base = { id: 1, item: "7", sectionTitle: " MANAGEMENT'S DISCUSSION ", content: "Gross profit rate fell 20 basis points.", tokenCount: 9 };
  it("prefixes the section and subheading", () => {
    expect(embeddingText({ ...base, heading: "Gross profit rate" })).toBe(
      "Item 7: MANAGEMENT'S DISCUSSION — Gross profit rate\n\nGross profit rate fell 20 basis points.",
    );
  });
  it("leaves out a missing or blank heading", () => {
    expect(embeddingText({ ...base, heading: null })).toBe("Item 7: MANAGEMENT'S DISCUSSION\n\nGross profit rate fell 20 basis points.");
    expect(embeddingText({ ...base, heading: "  " })).toBe("Item 7: MANAGEMENT'S DISCUSSION\n\nGross profit rate fell 20 basis points.");
  });
});

describe("planBatches", () => {
  const items = (tokens: number[]) => tokens.map((tokenCount, id) => ({ id, tokenCount }));
  it("splits on the input limit", () => {
    expect(planBatches(items([1, 1, 1, 1, 1]), 2, 100).map((b) => b.length)).toEqual([2, 2, 1]);
  });
  it("splits on the token limit and keeps order", () => {
    const batches = planBatches(items([40, 40, 40, 10]), 10, 100);
    expect(batches.map((b) => b.map((i) => i.id))).toEqual([[0, 1], [2, 3]]);
  });
  it("sends an oversized passage alone instead of dropping it", () => {
    expect(planBatches(items([10, 500, 10]), 10, 100).map((b) => b.length)).toEqual([1, 1, 1]);
  });
  it("returns nothing for nothing", () => {
    expect(planBatches([])).toEqual([]);
  });
});
