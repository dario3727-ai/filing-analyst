/**
 * Finds the standard 10-K items in a filing's text blocks.
 *
 * How (designed from the seven test-set filings, docs/decisions.md):
 *  - A heading candidate is a SHORT block (≤ 250 characters) that STARTS
 *    with "Item N" (optionally after "Part II,"). Cross-references like
 *    "see Item 1A. Risk Factors" sit inside long paragraphs, so they never
 *    qualify.
 *  - Every filing lists Items 1–16 twice: the table of contents, then the
 *    body. The LAST candidate for each item is the real heading.
 *  - A section runs from its heading to the next detected item heading
 *    (any item, so tiny ones like 1B "None" still end the one before).
 *  - If a heading is bare ("ITEM 1."), the next short block is its title.
 */
import { decodeFiling, htmlToBlocks, type Block } from "./blocks.ts";

/** Items we extract: Business, Risk Factors, MD&A, Market Risk, Financial Statements. */
export const TARGET_ITEMS = ["1", "1A", "7", "7A", "8"] as const;
export type TargetItem = (typeof TARGET_ITEMS)[number];

export interface Section {
  item: TargetItem;
  title: string;
  pageStart: number;
  pageEnd: number;
  wordCount: number;
  /** The section's blocks after the heading (and its title line, if separate). */
  blocks: Block[];
}

export interface ParseResult {
  sections: Section[];
  /** Target items not found. */
  missing: TargetItem[];
  warnings: string[];
  totalBlocks: number;
  totalPages: number;
}

const MAX_HEADING_CHARS = 250;
const MAX_TITLE_CHARS = 150;
const ITEM_HEADING = /^(?:part\s+[ivx]+\s*[,.:–—-]?\s*)?item\s*(\d{1,2}[a-c]?)\b\s*[.:–—-]?\s*(.*)$/i;

/** Sort key: "1" < "1A" < "1B" < "2" ... < "16". */
function itemOrder(item: string): number {
  const m = /^(\d{1,2})([A-C]?)$/.exec(item);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]) * 10 + (m[2] ? m[2].charCodeAt(0) - 64 : 0);
}

const words = (text: string) => (text === "" ? 0 : text.split(" ").length);

interface Heading {
  item: string;
  index: number;
  rest: string;
}

export function findHeadings(blocks: readonly Block[]): Map<string, Heading> {
  const last = new Map<string, Heading>();
  blocks.forEach((block, index) => {
    if (block.text.length > MAX_HEADING_CHARS) return;
    const m = ITEM_HEADING.exec(block.text);
    if (!m?.[1]) return;
    const item = m[1].toUpperCase();
    if (!Number.isFinite(itemOrder(item)) || Number(item.replace(/[A-C]/, "")) > 16) return;
    last.set(item, { item, index, rest: (m[2] ?? "").trim() });
  });
  return last;
}

export function sectionsFromBlocks(blocks: readonly Block[]): ParseResult {
  const headings = findHeadings(blocks);
  const ordered = [...headings.values()].sort((a, b) => a.index - b.index);
  const warnings: string[] = [];

  // Body headings should run in item order; a break means something was misread.
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (prev && cur && itemOrder(cur.item) < itemOrder(prev.item)) {
      warnings.push(`Item ${cur.item} heading appears after Item ${prev.item}; sections may be misplaced`);
    }
  }

  const sections: Section[] = [];
  const missing: TargetItem[] = [];
  for (const item of TARGET_ITEMS) {
    const heading = headings.get(item);
    if (!heading) {
      missing.push(item);
      continue;
    }
    const next = ordered.find((h) => h.index > heading.index);
    const end = next ? next.index : blocks.length;

    let bodyStart = heading.index + 1;
    let title = heading.rest;
    if (title === "") {
      const titleBlock = blocks[heading.index + 1];
      if (titleBlock && titleBlock.text.length <= MAX_TITLE_CHARS && heading.index + 1 < end) {
        title = titleBlock.text;
        bodyStart++;
      }
    }

    const body = blocks.slice(bodyStart, end);
    const headingBlock = blocks[heading.index];
    if (body.length === 0) warnings.push(`Item ${item} has a heading but no text`);
    sections.push({
      item,
      title: title.replace(/[.:]\s*$/, ""),
      pageStart: headingBlock?.page ?? 0,
      pageEnd: body.at(-1)?.page ?? headingBlock?.page ?? 0,
      wordCount: body.reduce((n, b) => n + words(b.text), 0),
      blocks: body,
    });
  }

  return {
    sections,
    missing,
    warnings,
    totalBlocks: blocks.length,
    totalPages: blocks.at(-1)?.page ?? 0,
  };
}

/** Raw 10-K bytes → sections. */
export function parseFiling(bytes: Uint8Array): ParseResult {
  return sectionsFromBlocks(htmlToBlocks(decodeFiling(bytes)));
}
