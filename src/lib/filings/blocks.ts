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
}

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

  const flush = () => {
    const text = normalizeText(buffer.join(""));
    if (text !== "") blocks.push({ text, page });
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
      flush();
      return;
    }

    const isBlock = BLOCK_TAGS.has(name);
    if (BREAK_BEFORE.test(style)) {
      flush();
      page++;
    }
    if (isBlock) flush();
    // Table cells sit side by side in a row: keep a space between them.
    if (name === "td" || name === "th") buffer.push(" ");
    for (const child of node.children) walk(child);
    if (name === "td" || name === "th") buffer.push(" ");
    if (isBlock) flush();
    if (BREAK_AFTER.test(style)) {
      flush();
      page++;
    }
  };

  for (const child of doc.children) walk(child);
  flush();
  return blocks;
}
