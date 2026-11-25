/**
 * Pure helpers for embedding passages: the exact text sent to Voyage, and
 * how passages are grouped into requests.
 */
import { MAX_INPUTS_PER_REQUEST } from "./client.ts";

/** Our estimate (≈ 1.33 tokens per word) runs a little low against real tokenizers, so leave room. */
export const MAX_ESTIMATED_TOKENS_PER_REQUEST = 50_000;

export interface PassageForEmbedding {
  id: number;
  item: string;
  sectionTitle: string;
  heading: string | null;
  content: string;
  /** Estimated tokens (chunks.token_count). */
  tokenCount: number;
}

/**
 * "Item 7: MANAGEMENT'S DISCUSSION… — Gross profit rate" + blank line + passage.
 * The prefix lets a passage be found by its topic even when its text never names it.
 */
export function embeddingText(p: PassageForEmbedding): string {
  const heading = p.heading?.trim();
  const prefix = `Item ${p.item}: ${p.sectionTitle.trim()}${heading ? ` — ${heading}` : ""}`;
  return `${prefix}\n\n${p.content}`;
}

/** Groups passages in order: at most `maxInputs` each and `maxTokens` estimated tokens (one oversized passage goes alone). */
export function planBatches<T extends { tokenCount: number }>(
  items: readonly T[],
  maxInputs = MAX_INPUTS_PER_REQUEST,
  maxTokens = MAX_ESTIMATED_TOKENS_PER_REQUEST,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  for (const item of items) {
    if (current.length > 0 && (current.length >= maxInputs || tokens + item.tokenCount > maxTokens)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(item);
    tokens += item.tokenCount;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
