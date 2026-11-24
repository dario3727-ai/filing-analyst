import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/filings/blocks";
import { CHUNK_MAX_TOKENS, CHUNK_MIN_TOKENS, chunkSection, estimateTokens, isSubheading, type Chunk } from "@/lib/filings/chunks";
import { parseFiling, type Section, type TargetItem } from "@/lib/filings/sections";
import { FILING_FIXTURES, loadFilingBytes } from "../../../tests/filing-fixtures";

const text = (t: string, page = 1): Block => ({ text: t, page, kind: "text" });
const row = (t: string, page = 1): Block => ({ text: t, page, kind: "table" });
const paragraph = (words: number, tag = "w") => Array.from({ length: words }, (_, i) => `${tag}${i}`).join(" ") + ".";
const section = (item: TargetItem, blocks: Block[]): Section => ({
  item,
  title: "Test",
  pageStart: 1,
  pageEnd: blocks.at(-1)?.page ?? 1,
  wordCount: 0,
  blocks,
});

/** All passage text, whitespace-collapsed, to check that kept text survives intact. */
const joined = (chunks: Chunk[]) => chunks.map((c) => c.text).join(" ").replace(/\s+/g, " ");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("chunkSection (rules)", () => {
  it("packs paragraphs up to ~300 tokens without splitting them", () => {
    const chunks = chunkSection(section("7", [text(paragraph(100, "a")), text(paragraph(100, "b")), text(paragraph(100, "c"))]));
    // 100 words ≈ 133 tokens: two fit in ~300, the third starts a new passage.
    expect(chunks.map((c) => c.wordCount)).toEqual([200, 100]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it("splits a long paragraph at sentence ends, never above the max", () => {
    const sentence = (i: number) => `Sentence number ${i} explains one more reason sales changed this year.`;
    const long = Array.from({ length: 60 }, (_, i) => sentence(i)).join(" "); // ~660 words
    const chunks = chunkSection(section("7", [text(long)]));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
      expect(c.text).toMatch(/\.$/); // ends on a sentence boundary
    }
    expect(joined(chunks)).toContain(squash(long));
  });

  it("splits a giant sentence at word boundaries as a last resort", () => {
    const giant = paragraph(1000);
    const chunks = chunkSection(section("1A", [text(giant)]));
    expect(chunks.every((c) => c.tokenCount <= CHUNK_MAX_TOKENS)).toBe(true);
    expect(joined(chunks)).toContain(squash(giant));
  });

  it("starts a new passage at a subheading and records it", () => {
    const chunks = chunkSection(
      section("1A", [text("Strategic Risks"), text(paragraph(80, "s")), text("Operational Risks"), text(paragraph(80, "o"))]),
    );
    expect(chunks.map((c) => c.heading)).toEqual(["Strategic Risks", "Operational Risks"]);
    expect(chunks[1]?.text.startsWith("Operational Risks\n\n")).toBe(true);
  });

  it("keeps only the latest of two subheadings in a row, and drops a trailing one", () => {
    const chunks = chunkSection(section("1A", [text("Risks"), text("Strategic Risks"), text(paragraph(80)), text("Orphan Heading")]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe("Strategic Risks");
    expect(chunks[0]?.text).not.toMatch(/^Risks/);
  });

  it("puts data tables in their own passages, rows unbroken", () => {
    const chunks = chunkSection(
      section("7", [text(paragraph(80)), row("Net sales $ 706,413 $ 674,538"), row("Gross profit $ 176,000 $ 166,000"), text(paragraph(80, "z"))]),
    );
    expect(chunks.map((c) => c.kind)).toEqual(["text", "table", "text"]);
    expect(chunks[1]?.text).toBe("Net sales $ 706,413 $ 674,538\nGross profit $ 176,000 $ 166,000");
  });

  it("skips table rows in Item 8 but keeps its text", () => {
    const chunks = chunkSection(section("8", [text(paragraph(80, "note")), row("Total assets $ 260,823 $ 252,399")]));
    expect(chunks.every((c) => c.kind === "text")).toBe(true);
    expect(joined(chunks)).not.toContain("Total assets");
  });

  it("merges a tiny passage into the next one (Item 8 statement title + 'See accompanying notes.')", () => {
    const chunks = chunkSection(
      section("8", [
        text("Consolidated Balance Sheets"),
        text("See accompanying notes."),
        text("Summary of Accounting Policies"),
        text(paragraph(120, "policy")),
      ]),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe("Consolidated Balance Sheets");
    expect(chunks[0]?.text).toContain("See accompanying notes.");
    expect(chunks[0]?.text).toContain("policy119.");
  });

  it("merges a tiny last passage into the previous one", () => {
    const chunks = chunkSection(section("7", [text(paragraph(200)), text(paragraph(10, "tail"))]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("tail9.");
  });

  it("tracks the pages a passage spans", () => {
    const chunks = chunkSection(section("7", [text(paragraph(60, "a"), 12), text(paragraph(60, "b"), 13)]));
    expect(chunks[0]).toMatchObject({ pageStart: 12, pageEnd: 13 });
  });

  it("recognizes subheadings", () => {
    expect(isSubheading(text("Fiscal 2025 Compared to Fiscal 2024"))).toBe(true);
    expect(isSubheading(text("We face strong competition."))).toBe(false); // ends like a sentence
    expect(isSubheading(text("• Grocery"))).toBe(false); // bullet
    expect(isSubheading(row("2025 2024"))).toBe(false);
    expect(isSubheading(text("2025"))).toBe(false); // no letters
  });

  it("estimates about 1.33 tokens per word", () => {
    expect(estimateTokens(paragraph(300))).toBe(399);
  });
});

describe("chunkSection on all seven real 10-Ks", () => {
  it.each(FILING_FIXTURES)("$ticker: passages within limits, nothing lost, Item 8 without tables", ({ ticker, fiscalYear }) => {
    const parsed = parseFiling(loadFilingBytes(ticker, fiscalYear));
    let total = 0;
    for (const s of parsed.sections) {
      const chunks = chunkSection(s);
      total += chunks.length;
      expect(chunks.length, `${ticker} Item ${s.item}`).toBeGreaterThan(0);

      for (const c of chunks) {
        expect(c.tokenCount, `${ticker} Item ${s.item} #${c.chunkIndex}`).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
        expect(c.text.trim()).not.toBe("");
        expect(c.pageEnd).toBeGreaterThanOrEqual(c.pageStart);
      }
      // Only the last passage of a section may be smaller than the minimum
      // (when it couldn't be merged), plus passages cut short by a subheading.
      const tooSmall = chunks.filter((c) => c.tokenCount < CHUNK_MIN_TOKENS && c.heading === null).length;
      expect(tooSmall, `${ticker} Item ${s.item} tiny passages`).toBeLessThanOrEqual(Math.max(2, chunks.length * 0.1));

      if (s.item === "8") expect(chunks.some((c) => c.kind === "table"), `${ticker} Item 8 tables`).toBe(false);

      // Every kept, non-subheading block survives intact somewhere in the passages.
      const all = joined(chunks);
      for (const b of s.blocks) {
        if (isSubheading(b) || (s.item === "8" && b.kind === "table")) continue;
        expect(all.includes(squash(b.text)), `${ticker} Item ${s.item} lost: "${b.text.slice(0, 60)}"`).toBe(true);
      }
    }
    expect(total).toBeGreaterThan(60);
  });
});
