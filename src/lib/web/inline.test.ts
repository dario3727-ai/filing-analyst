import { describe, expect, it } from "vitest";
import { splitBold } from "./inline.ts";

describe("splitBold", () => {
  it("turns **labels** into bold runs", () => {
    expect(splitBold("**Exposure.** Roughly half is imported.")).toEqual([
      { text: "Exposure.", bold: true },
      { text: " Roughly half is imported.", bold: false },
    ]);
  });
  it("leaves plain text and unmatched asterisks alone", () => {
    expect(splitBold("Plain text")).toEqual([{ text: "Plain text", bold: false }]);
    expect(splitBold("a ** b")).toEqual([{ text: "a ** b", bold: false }]);
    expect(splitBold("")).toEqual([]);
  });
});
