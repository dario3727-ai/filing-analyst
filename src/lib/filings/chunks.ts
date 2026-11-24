/**
 * Splits a parsed 10-K section into passages for search and citations
 * (decision 2026-11-24): about 300 tokens each, never over 450, no overlap.
 *
 *  - Built from whole paragraphs; a paragraph over the limit is split at
 *    sentence ends, and a giant sentence at word boundaries.
 *  - A subheading (short, title-like line) starts a new passage and becomes
 *    its `heading`, so passages stay on one topic and show where they sit.
 *  - Consecutive data-table rows form table passages, kept apart from text.
 *    Item 8 (financial statements) skips table rows: XBRL already has those
 *    numbers exactly. Its text, such as the notes, is kept.
 *  - A tiny last passage is merged into the one before it.
 *
 * Token counts are estimates (≈ 1.33 tokens per word): Voyage's tokenizer
 * isn't available offline, and sizing doesn't need exact counts.
 */
import type { Block } from "./blocks.ts";
import type { Section, TargetItem } from "./sections.ts";

export const CHUNK_TARGET_TOKENS = 300;
export const CHUNK_MAX_TOKENS = 450;
export const CHUNK_MIN_TOKENS = 60;
const TOKENS_PER_WORD = 1.33;
const MAX_SUBHEADING_WORDS = 12;

export interface Chunk {
  item: TargetItem;
  /** Order within the section, from 0. */
  chunkIndex: number;
  /** Nearest subheading above the passage, if any. */
  heading: string | null;
  kind: "text" | "table";
  pageStart: number;
  pageEnd: number;
  text: string;
  wordCount: number;
  tokenCount: number;
}

const countWords = (text: string) => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);
export const estimateTokens = (text: string) => Math.ceil(countWords(text) * TOKENS_PER_WORD);

/** A short, title-like text line: "Strategic Risks", "Fiscal 2025 Compared to Fiscal 2024". */
export function isSubheading(block: Block): boolean {
  if (block.kind !== "text") return false;
  const text = block.text;
  const words = countWords(text);
  return words > 0 && words <= MAX_SUBHEADING_WORDS && /[A-Za-z]/.test(text) && !/[.;:,]$/.test(text) && !/^[•●▪\-–—]/.test(text);
}

/** Splits text into sentences, keeping the punctuation. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?][)"”’]?)\s+(?=[A-Z(“"])/).filter((s) => s.trim() !== "");
}

/** Splits text that's too long into pieces under the max: by sentence, then by words. */
function splitLong(text: string): string[] {
  if (estimateTokens(text) <= CHUNK_MAX_TOKENS) return [text];
  const maxWords = Math.floor(CHUNK_MAX_TOKENS / TOKENS_PER_WORD);
  const pieces: string[] = [];
  let current: string[] = [];
  const push = () => {
    if (current.length > 0) pieces.push(current.join(" "));
    current = [];
  };
  for (const sentence of sentences(text)) {
    if (estimateTokens(sentence) > CHUNK_MAX_TOKENS) {
      push();
      const words = sentence.split(/\s+/);
      for (let i = 0; i < words.length; i += maxWords) pieces.push(words.slice(i, i + maxWords).join(" "));
      continue;
    }
    if (estimateTokens([...current, sentence].join(" ")) > CHUNK_MAX_TOKENS) push();
    current.push(sentence);
  }
  push();
  return pieces;
}

interface Unit {
  text: string;
  kind: "text" | "table";
  pageStart: number;
  pageEnd: number;
  subheading: boolean;
}

/** Paragraphs, subheadings and grouped table rows, in order. */
function toUnits(section: Section): Unit[] {
  const units: Unit[] = [];
  for (const block of section.blocks) {
    if (block.kind === "table" && section.item === "8") continue;
    const last = units.at(-1);
    if (block.kind === "table" && last?.kind === "table") {
      last.text += `\n${block.text}`;
      last.pageEnd = block.page;
      continue;
    }
    units.push({
      text: block.text,
      kind: block.kind,
      pageStart: block.page,
      pageEnd: block.page,
      subheading: isSubheading(block),
    });
  }
  return units;
}

export function chunkSection(section: Section): Chunk[] {
  const chunks: Omit<Chunk, "chunkIndex">[] = [];
  let parts: string[] = [];
  let kind: "text" | "table" = "text";
  let pageStart = 0;
  let pageEnd = 0;
  let heading: string | null = null;
  let headingOnly = true; // nothing but a subheading in the current passage so far

  const tokens = () => estimateTokens(parts.join(" "));
  const flush = () => {
    if (parts.length === 0 || headingOnly) return;
    const text = parts.join(kind === "table" ? "\n" : "\n\n");
    chunks.push({ item: section.item, heading, kind, pageStart, pageEnd, text, wordCount: countWords(text), tokenCount: estimateTokens(text) });
    parts = [];
    headingOnly = true;
  };
  const add = (text: string, unit: Unit, isHeadingLine: boolean) => {
    if (parts.length === 0) pageStart = unit.pageStart;
    parts.push(text);
    pageEnd = unit.pageEnd;
    kind = unit.kind;
    if (!isHeadingLine) headingOnly = false;
  };

  for (const unit of toUnits(section)) {
    if (unit.subheading) {
      if (!headingOnly) flush();
      else parts = []; // two subheadings in a row: keep only the latest
      heading = unit.text;
      add(unit.text, unit, true);
      continue;
    }
    if (parts.length > 0 && !headingOnly && unit.kind !== kind) flush();

    for (const piece of unit.kind === "table" ? splitTable(unit.text) : splitLong(unit.text)) {
      const pieceTokens = estimateTokens(piece);
      if (!headingOnly && tokens() >= CHUNK_MIN_TOKENS && tokens() + pieceTokens > CHUNK_TARGET_TOKENS) flush();
      if (tokens() + pieceTokens > CHUNK_MAX_TOKENS) {
        // A heading line alone can't take this piece: start the piece fresh, keeping the heading as context.
        if (headingOnly) parts = [];
        else flush();
      }
      add(piece, unit, false);
    }
  }
  flush();

  return mergeTinyChunks(chunks).map((c, chunkIndex) => ({ ...c, chunkIndex }));
}

type Draft = Omit<Chunk, "chunkIndex">;

/**
 * A passage under the minimum (e.g. a statement title plus "See
 * accompanying notes." once Item 8's tables are skipped) is too small to be
 * useful alone: merge it into the next passage of the same kind, or into the
 * previous one if it's last, whenever the result stays under the max.
 */
function mergeTinyChunks(input: readonly Draft[]): Draft[] {
  const out: Draft[] = [];
  const join = (a: Draft, b: Draft): Draft => {
    const text = `${a.text}${a.kind === "table" ? "\n" : "\n\n"}${b.text}`;
    return { ...a, pageEnd: b.pageEnd, text, wordCount: countWords(text), tokenCount: estimateTokens(text) };
  };
  let carry: Draft | null = null;
  for (const chunk of input) {
    let current = chunk;
    if (carry) {
      if (carry.kind === current.kind && carry.tokenCount + current.tokenCount <= CHUNK_MAX_TOKENS) {
        current = join(carry, current);
      } else {
        out.push(carry);
      }
      carry = null;
    }
    if (current.tokenCount < CHUNK_MIN_TOKENS) carry = current;
    else out.push(current);
  }
  if (carry) {
    const prev = out.at(-1);
    if (prev && prev.kind === carry.kind && prev.tokenCount + carry.tokenCount <= CHUNK_MAX_TOKENS) out[out.length - 1] = join(prev, carry);
    else out.push(carry);
  }
  return out;
}

/** Table units are split by rows so a passage never cuts a row in half. */
function splitTable(text: string): string[] {
  if (estimateTokens(text) <= CHUNK_MAX_TOKENS) return [text];
  const pieces: string[] = [];
  let current: string[] = [];
  for (const row of text.split("\n")) {
    if (current.length > 0 && estimateTokens([...current, row].join(" ")) > CHUNK_MAX_TOKENS) {
      pieces.push(current.join("\n"));
      current = [];
    }
    if (estimateTokens(row) > CHUNK_MAX_TOKENS) {
      pieces.push(...splitLong(row));
      continue;
    }
    current.push(row);
  }
  if (current.length > 0) pieces.push(current.join("\n"));
  return pieces;
}
