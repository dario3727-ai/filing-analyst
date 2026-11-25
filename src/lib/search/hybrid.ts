/**
 * Hybrid passage search: embed the question (Voyage, input_type "query"),
 * then call the Postgres function search_chunks, which fuses semantic and
 * keyword rankings (supabase/migrations/20261124230000_search_chunks.sql).
 * The database call is passed in, so tests run without Supabase or Voyage.
 */
import type { VoyageClient } from "../voyage/client.ts";

export const DEFAULT_PASSAGES = 8;
export const MAX_PASSAGES = 50;
export const MAX_QUESTION_CHARS = 1000;

export interface SearchOptions {
  companyId: number;
  fromYear: number;
  toYear: number;
  /** Passages to return; default 8, at most 50. */
  limit?: number;
  /** Only these items, e.g. ["1A"] for Risk Factors. */
  items?: readonly string[];
  /**
   * Words left out of the keyword search only, normally the company's own
   * name: every passage searched is that company's, so "Target" in the
   * question matched nearly all of them and buried the buyback passage
   * (keyword #19 → fused #1 without it). The meaning search keeps the full question.
   */
  excludeTerms?: readonly string[];
}

/** The words of a company's name and its ticker, for `excludeTerms`: "TARGET CORP", "TGT" → ["target", "corp", "tgt"]. */
export function companyTerms(name: string, ticker: string): string[] {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  return [...new Set([...words, ticker.toLowerCase()])];
}

/** The question with excluded words (and their possessive "'s") removed, for keyword search. */
export function keywordText(question: string, excludeTerms: readonly string[] = []): string {
  let text = question;
  for (const term of excludeTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\b${escaped}(?:['’]s)?\\b`, "gi"), " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

export interface Passage {
  id: number;
  filingId: number;
  fiscalYear: number;
  item: string;
  heading: string | null;
  /** "xbrl": a reported figure from financial_facts (qa/xbrl-passages.ts), not a stored 10-K passage. */
  kind: "text" | "table" | "xbrl";
  pageStart: number;
  pageEnd: number;
  content: string;
  /** Position in the meaning-based list (1 = closest); null if not in it. */
  semanticRank: number | null;
  /** Position in the keyword list; null if no keyword matched. */
  keywordRank: number | null;
  /** Reciprocal Rank Fusion score; higher is better. */
  score: number;
}

/** A Postgres function call, e.g. supabase.rpc(name, args). */
export type RpcCall = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export interface SearchDeps {
  voyage: Pick<VoyageClient, "embed">;
  rpc: RpcCall;
}

/** Checks the question and options; returns the cleaned question. */
export function validateSearch(question: string, options: SearchOptions): string {
  const q = question.trim();
  if (q === "") throw new Error("Question is empty");
  if (q.length > MAX_QUESTION_CHARS) throw new Error(`Question is longer than ${MAX_QUESTION_CHARS} characters`);
  if (!Number.isInteger(options.companyId) || options.companyId <= 0) throw new Error("Invalid company id");
  if (!Number.isInteger(options.fromYear) || !Number.isInteger(options.toYear) || options.fromYear > options.toYear) {
    throw new Error(`Invalid year range ${options.fromYear}–${options.toYear}`);
  }
  const limit = options.limit ?? DEFAULT_PASSAGES;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PASSAGES) throw new Error(`limit must be 1–${MAX_PASSAGES}`);
  return q;
}

const toNumberOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** One row from search_chunks → Passage, rejecting rows that don't have the expected shape. */
export function toPassage(row: unknown): Passage {
  if (typeof row !== "object" || row === null) throw new Error("search_chunks returned a non-object row");
  const r = row as Record<string, unknown>;
  if (typeof r.content !== "string" || r.id === undefined || typeof r.item !== "string") {
    throw new Error("search_chunks returned a row without id, item or content");
  }
  return {
    id: Number(r.id),
    filingId: Number(r.filing_id),
    fiscalYear: Number(r.fiscal_year),
    item: r.item,
    heading: typeof r.heading === "string" ? r.heading : null,
    kind: r.kind === "table" ? "table" : "text",
    pageStart: Number(r.page_start),
    pageEnd: Number(r.page_end),
    content: r.content,
    semanticRank: toNumberOrNull(r.semantic_rank),
    keywordRank: toNumberOrNull(r.keyword_rank),
    score: Number(r.score),
  };
}

/** Embeds a question as a Voyage "query". */
export async function embedQuestion(question: string, voyage: SearchDeps["voyage"]): Promise<number[]> {
  const { embeddings } = await voyage.embed([question], "query");
  const embedding = embeddings[0];
  if (!embedding) throw new Error("Voyage returned no embedding for the question");
  return embedding;
}

export async function searchPassages(question: string, options: SearchOptions, deps: SearchDeps): Promise<Passage[]> {
  const q = validateSearch(question, options);
  return searchWithEmbedding(q, await embedQuestion(q, deps.voyage), options, deps.rpc);
}

/** search_chunks with an already-embedded (and already validated) question, so one embedding serves several searches. */
export async function searchWithEmbedding(q: string, embedding: readonly number[], options: SearchOptions, rpc: RpcCall): Promise<Passage[]> {
  const { data, error } = await rpc("search_chunks", {
    query_embedding: JSON.stringify(embedding), // pgvector's "[0.1,0.2,...]" text form
    query_text: keywordText(q, options.excludeTerms),
    p_company_id: options.companyId,
    p_from_year: options.fromYear,
    p_to_year: options.toYear,
    match_count: options.limit ?? DEFAULT_PASSAGES,
    p_items: options.items && options.items.length > 0 ? [...options.items] : null,
  });
  if (error) throw new Error(`Search failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error("Search returned no rows array");
  return data.map(toPassage);
}
