/**
 * Item 1A → individual risks (decisions 2026-11-25). Pure.
 * Most 10-Ks start each risk with a bold or italic title sentence ("We face
 * strong competition from other retailers…") under short bold category
 * headings ("Strategic Risks"). Kroger has only ALL-CAPS category headings
 * ("PRODUCT SAFETY") with plain paragraphs, so when a section has fewer
 * than 3 title sentences, each heading starts a risk instead.
 */
import type { Block } from "../filings/blocks.ts";

export interface Risk {
  /** Position within the section, 0-based. */
  index: number;
  title: string;
  /** The category heading above it, if any ("Strategic Risks"). */
  category: string | null;
  /** The explanation paragraphs, joined with blank lines. */
  body: string;
  page: number;
}

/** Longest emphasized sentence still treated as a title (Five Below's bold 100-word intro is not one). */
export const MAX_TITLE_WORDS = 75;
const MIN_TITLE_WORDS = 4;
const MAX_HEADING_WORDS = 15;
const MIN_TITLES = 3;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export type BlockRole = "title" | "heading" | "body";

/** Title: emphasized sentence; heading: short emphasized line without end punctuation; else body. */
export function blockRole(block: Block): BlockRole {
  if (block.kind !== "text" || !block.emphasis) return "body";
  const n = words(block.text);
  if (/[.?!]["”’)]?$/.test(block.text)) return n >= MIN_TITLE_WORDS && n <= MAX_TITLE_WORDS ? "title" : "body";
  return n <= MAX_HEADING_WORDS && !/^[•●▪\-–—]/.test(block.text) ? "heading" : "body";
}

export function splitRisks(blocks: readonly Block[]): Risk[] {
  const roles = blocks.map(blockRole);
  const byTitle = roles.filter((r) => r === "title").length >= MIN_TITLES;
  const starts: BlockRole = byTitle ? "title" : "heading";

  const risks: Risk[] = [];
  let category: string | null = null;
  let current: { title: string; category: string | null; page: number; parts: string[] } | null = null;
  const close = () => {
    if (current) risks.push({ index: risks.length, title: current.title, category: current.category, body: current.parts.join("\n\n"), page: current.page });
    current = null;
  };

  blocks.forEach((block, i) => {
    const role = roles[i];
    if (byTitle && role === "heading") {
      close();
      category = block.text;
    } else if (role === starts) {
      close();
      current = { title: block.text, category: byTitle ? category : null, page: block.page, parts: [] };
    } else if (current) {
      current.parts.push(block.text);
    }
    // Text before the first risk is the section's introduction: not a risk.
  });
  close();
  return risks;
}
