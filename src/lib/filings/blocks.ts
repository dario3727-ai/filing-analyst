/**
 * Raw 10-K bytes → an ordered list of visible text blocks, each tagged with
 * the page it's on. This is the first stage of the section parser.
 *
 *  - Decoding: strict UTF-8, falling back to Windows-1252 (older filings).
 *  - Dropped: the hidden inline-XBRL header, any element styled
 *    display:none (hidden XBRL facts), scripts, styles and <head>.
 *  - Blocks: one per paragraph-like element (p, div, li, headings) and per
 *    table row, so "Item 1A." and "Risk Factors" in adjacent cells of a
 *    row read as one line. <br> also ends a block.
 *  - Pages: start at 1; CSS page-break-before/after (or break-before/after:
 *    page) moves to the next page.
 *  - Kind: rows of a DATA table are "table"; everything else is "text".
 *    Filings also use tables for layout (a "•" cell beside a text cell), so
 *    a table counts as data only if at least 30% of its non-empty cells are
 *    numbers like "$ 706,413", "(1.2)", "15%" or "—".
 */
import { ElementType, parseDocument } from "htmlparser2";

type HtmlDocument = ReturnType<typeof parseDocument>;
type HtmlNode = HtmlDocument["children"][number];
// ElementType.Text is a value (the string "text"); `typeof` turns it into a type.
type HtmlElement = Extract<HtmlNode, { attribs: unknown }>;
type HtmlText = Extract<HtmlNode, { type: typeof ElementType.Text }>;

// Node types are checked via their `type` field (htmlparser2's ElementType).
const isText = (node: HtmlNode): node is HtmlText => node.type === ElementType.Text;
const isElement = (node: HtmlNode): node is HtmlElement => "attribs" in node;

export interface Block {
  text: string;
  page: number;
  kind: "text" | "table";
}

/** A cell that holds a number, a placeholder dash, or currency/percent symbols around one. */
const NUMERIC_CELL = /^[$€£(]*\s*[-–—]?\s*[\d.,]*\d[\d.,]*\s*[)%]*$|^[-–—]+$/;
export const DATA_TABLE_MIN_NUMERIC_SHARE = 0.3;

export function decodeFiling(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const SKIP_TAGS = new Set(["head", "script", "style", "title", "ix:header", "noscript"]);
const BLOCK_TAGS = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "center", "body"]);
const HIDDEN = /display\s*:\s*none/i;
const BREAK_BEFORE = /(page-break-before|break-before)\s*:\s*(always|page)/i;
const BREAK_AFTER = /(page-break-after|break-after)\s*:\s*(always|page)/i;

/**
 * Removes invisible zero-width characters (Kroger's filing uses them as
 * spacers), collapses whitespace including non-breaking spaces, and trims.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[​‌‍⁠﻿]/g, "")
    .replace(/[\s   ]+/g, " ")
    .trim();
}

export function htmlToBlocks(html: string): Block[] {
  const doc = parseDocument(html, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  const blocks: Block[] = [];
  let page = 1;
  let buffer: string[] = [];
  // One entry per open <table>: where its blocks start and its cell tally.
  const tables: { startBlock: number; cells: number; numeric: number }[] = [];
  // Inside a table row, a whole row is one block even when each cell wraps
  // its text in <p> or <div> (Kroger does this for 97% of its cells).
  let rowDepth = 0;

  const flush = () => {
    const text = normalizeText(buffer.join(""));
    if (text !== "") blocks.push({ text, page, kind: "text" });
    buffer = [];
  };

  const walk = (node: HtmlNode): void => {
    if (isText(node)) {
      buffer.push(node.data);
      return;
    }
    if (!isElement(node)) return; // comments, processing instructions

    const name = node.name;
    if (SKIP_TAGS.has(name)) return;
    const style = node.attribs.style ?? "";
    if (HIDDEN.test(style)) return;

    if (name === "br") {
      if (rowDepth > 0) buffer.push(" ");
      else flush();
      return;
    }

    // Paragraph tags end a block, except inside a table row (the row is the block).
    const isBlock = BLOCK_TAGS.has(name) && (rowDepth === 0 || name === "tr");
    if (BREAK_BEFORE.test(style)) {
      flush();
      page++;
    }
    if (isBlock) flush();
    if (name === "table") tables.push({ startBlock: blocks.length, cells: 0, numeric: 0 });

    const isCell = name === "td" || name === "th";
    // Table cells sit side by side in a row: keep a space between them.
    if (isCell) buffer.push(" ");
    const cellStart = buffer.length;
    if (name === "tr") rowDepth++;
    for (const child of node.children) walk(child);
    if (name === "tr") rowDepth--;
    if (isCell) {
      const cellText = normalizeText(buffer.slice(cellStart).join(""));
      const table = tables.at(-1);
      if (table && cellText !== "") {
        table.cells++;
        if (NUMERIC_CELL.test(cellText)) table.numeric++;
      }
      buffer.push(" ");
    }
    if (isBlock) flush();

    if (name === "table") {
      const table = tables.pop();
      const parent = tables.at(-1);
      if (table && parent) {
        // Nested table: the outermost table decides for all of its rows.
        parent.cells += table.cells;
        parent.numeric += table.numeric;
      } else if (table && table.numeric >= 2 && table.numeric / table.cells >= DATA_TABLE_MIN_NUMERIC_SHARE) {
        for (let i = table.startBlock; i < blocks.length; i++) {
          const block = blocks[i];
          if (block) block.kind = "table";
        }
      }
    }
    if (BREAK_AFTER.test(style)) {
      flush();
      page++;
    }
  };

  for (const child of doc.children) walk(child);
  flush();
  return removePageFurniture(blocks);
}

const PAGE_NUMBER = /^(page\s*)?[A-Z]?-?\d{1,3}$/i;
const CONTENTS_LINK = /^(table of contents|index|back to contents)$/i;
/** A short line naming the contents page, e.g. "RISK FACTORS Table of Contents" (Target 2025 headers). */
const CONTENTS_HEADER = /\btable of contents\b/i;
const MAX_RUNNING_HEADER_WORDS = 8;

/**
 * The form of a short line with its numbers blanked out, so a running header
 * that carries the page number ("TARGET CORPORATION 2025 Form 10-K 51",
 * "... 52") counts as one repeated line. Lines without letters (numbers only)
 * get no key: those are page numbers or table fragments, handled elsewhere.
 */
export function runningHeaderKey(text: string): string | undefined {
  return /[a-z]/i.test(text) ? text.replace(/\d+/g, "#") : undefined;
}

/**
 * Drops printing artifacts that aren't content: bare page numbers,
 * "Table of Contents" links and short lines naming them, and running headers
 * (a short line repeated on many pages, like "Walmart Inc.", or
 * "TARGET CORPORATION 2025 Form 10-K 51" with the page number changing).
 * A line counts as a running header if its numbers-blanked form appears at
 * least 8 times and on at least 20% of the pages, so a repeated subheading
 * such as "Overview" (a few times) is kept. "Item N" lines are never dropped.
 */
export function removePageFurniture(blocks: readonly Block[]): Block[] {
  const pages = blocks.at(-1)?.page ?? 1;
  const short = (b: Block) => b.kind === "text" && b.text.split(" ").length <= MAX_RUNNING_HEADER_WORDS;
  const counts = new Map<string, number>();
  for (const b of blocks) {
    const key = short(b) ? runningHeaderKey(b.text) : undefined;
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(8, Math.ceil(pages * 0.2));
  return blocks.filter((b) => {
    if (b.kind !== "text") return true;
    if (/^item\s*\d/i.test(b.text)) return true;
    if (PAGE_NUMBER.test(b.text) || CONTENTS_LINK.test(b.text)) return false;
    if (short(b) && CONTENTS_HEADER.test(b.text)) return false;
    const key = short(b) ? runningHeaderKey(b.text) : undefined;
    return key === undefined || (counts.get(key) ?? 0) < threshold;
  });
}
