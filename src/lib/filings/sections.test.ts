import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/filings/blocks";
import { parseFiling, sectionsFromBlocks, TARGET_ITEMS } from "@/lib/filings/sections";
import { FILING_FIXTURES, loadFilingBytes } from "../../../tests/filing-fixtures";

/** Blocks from lines; a line starting with "@N " sets the page. */
function toBlocks(lines: string[]): Block[] {
  let page = 1;
  return lines.flatMap((line) => {
    const m = /^@(\d+) (.*)$/.exec(line);
    if (m) {
      page = Number(m[1]);
      return [{ text: m[2] ?? "", page }];
    }
    return [{ text: line, page }];
  });
}

const filler = (n: number) => Array.from({ length: n }, (_, i) => `Sentence ${i} of the section text.`).join(" ");

const TOC = ["Item 1. Business 3", "Item 1A. Risk Factors 8", "Item 1B. Unresolved Staff Comments 15", "Item 7. MD&A 20", "Item 7A. Market Risk 30", "Item 8. Financial Statements 31", "Item 9. Changes 60"];

describe("sectionsFromBlocks (synthetic)", () => {
  const result = sectionsFromBlocks(
    toBlocks([
      "@1 ANNUAL REPORT",
      ...TOC,
      "@3 Item 1. Business",
      filler(30),
      "As discussed in Item 1A. Risk Factors, our results could change. " + filler(10), // cross-reference
      "@8 Item 1A. Risk Factors",
      filler(50),
      "@15 Item 1B. Unresolved Staff Comments",
      "None.",
      "@20 ITEM 7.",
      "MANAGEMENT'S DISCUSSION AND ANALYSIS",
      filler(40),
      "@30 Item 7A. Market Risk",
      filler(5),
      "@31 Item 8. Financial Statements",
      filler(60),
      "@60 Item 9. Changes",
      "None.",
    ]),
  );
  const section = (item: string) => result.sections.find((s) => s.item === item);

  it("finds every target and skips the table of contents", () => {
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(section("1")?.pageStart).toBe(3);
    expect(section("1A")?.pageStart).toBe(8);
  });

  it("ignores cross-references inside paragraphs", () => {
    // The cross-reference stays inside Item 1's text instead of starting Item 1A there.
    expect(section("1")?.blocks.some((b) => b.text.startsWith("As discussed in Item 1A"))).toBe(true);
  });

  it("ends a section at the next item, even a tiny one (1B 'None.')", () => {
    expect(section("1A")?.blocks.map((b) => b.text)).toEqual([filler(50)]);
    expect(section("1A")?.pageEnd).toBe(8);
  });

  it("takes a bare heading's title from the next line", () => {
    expect(section("7")).toMatchObject({ title: "MANAGEMENT'S DISCUSSION AND ANALYSIS", pageStart: 20 });
    expect(section("7")?.blocks[0]?.text).toBe(filler(40));
  });

  it("counts words and strips trailing punctuation from titles", () => {
    expect(section("7A")?.wordCount).toBe(filler(5).split(" ").length);
    expect(section("1A")?.title).toBe("Risk Factors");
  });

  it("reports missing items", () => {
    const r = sectionsFromBlocks(toBlocks(["Item 1. Business", filler(5), "Item 2. Properties", filler(5)]));
    expect(r.missing).toEqual(["1A", "7", "7A", "8"]);
  });

  it("warns when body headings are out of order", () => {
    const r = sectionsFromBlocks(toBlocks(["Item 7. MD&A", filler(5), "Item 1A. Risk Factors", filler(5)]));
    expect(r.warnings).toEqual([expect.stringMatching(/Item 1A heading appears after Item 7/)]);
  });
});

describe("parseFiling on all seven real 10-Ks", () => {
  const titles: Record<string, RegExp> = {
    "1": /business/i,
    "1A": /risk factors/i,
    "7": /management.s discussion/i,
    "7A": /market risk/i,
    "8": /financial statements/i,
  };
  const minWords: Record<string, number> = { "1": 2000, "1A": 4000, "7": 3000, "7A": 100, "8": 10000 };

  it.each(FILING_FIXTURES)("$ticker: all five sections found, titled, in order, after the table of contents", ({ ticker, fiscalYear }) => {
    const result = parseFiling(loadFilingBytes(ticker, fiscalYear));
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.sections.map((s) => s.item)).toEqual([...TARGET_ITEMS]);

    let lastPage = 0;
    for (const s of result.sections) {
      expect(s.title, `${ticker} Item ${s.item}`).toMatch(titles[s.item] ?? /./);
      expect(s.wordCount, `${ticker} Item ${s.item} words`).toBeGreaterThan(minWords[s.item] ?? 0);
      expect(s.pageStart, `${ticker} Item ${s.item} starts after the contents`).toBeGreaterThanOrEqual(3);
      expect(s.pageStart).toBeGreaterThanOrEqual(lastPage);
      expect(s.pageEnd).toBeGreaterThanOrEqual(s.pageStart);
      expect(s.blocks[0]?.text, `${ticker} Item ${s.item} body`).not.toMatch(/^item\s*\d/i);
      expect(s.blocks.every((b) => /\S/.test(b.text) && !/^[​\s]*$/.test(b.text))).toBe(true);
      lastPage = s.pageStart;
    }
  });
});
