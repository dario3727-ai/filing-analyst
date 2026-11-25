/**
 * Picks the passages Claude gets for a question, on top of hybrid search
 * (decisions 2026-11-24). Fixes found by the milestone 3 check:
 *  1. Each year is searched on its own, then years take turns filling the
 *     slots (4 per year, up to 12). Ranking all years together let one
 *     year's 10-K crowd out another: Target's top 8 had 7 fiscal 2024
 *     passages, and taking turns from that shared list still dropped
 *     Kroger's 2025 LIFO explanation, which ranks first within its own year.
 *  2. Tables stay with their lead-in. When a chosen passage is directly
 *     followed by a table in the same section, the table is added right
 *     after it (Gap: "…comp sales by brand is as follows:" was chosen, the
 *     table itself ranked 10th).
 *  3. Each search ranks at least 12 candidates before the top few are
 *     kept, and the company's own name is left out of the keyword search
 *     (see SearchOptions.excludeTerms).
 * One embedding serves all the per-year searches.
 */
import { embedQuestion, searchWithEmbedding, validateSearch, type Passage, type SearchDeps, type SearchOptions } from "./hybrid.ts";

/** Slots per year for multi-year questions, and the most passages chosen in total. */
export const SLOTS_PER_YEAR = 4;
export const MAX_SLOTS = 12;
/** At most this many tables added after their lead-in passages. */
export const MAX_ADDED_TABLES = 4;
/**
 * Candidates ranked per search before taking the top few. search_chunks
 * fuses its two lists from 4× this many each; asking for only 4 meant a
 * passage at keyword #19 got no keyword credit at all.
 */
export const MIN_CANDIDATES = 12;

/** Slots for a question: `limit` for one year; 4 per year (at least `limit`, at most 12) for several. */
export function slotsFor(limit: number, years: number): number {
  return years <= 1 ? limit : Math.min(MAX_SLOTS, Math.max(limit, SLOTS_PER_YEAR * years));
}

/** Takes passages year by year in turn until `limit`: A1, B1, A2, B2, … Within a year, rank order is kept. */
export function interleaveByYear(passages: readonly Passage[], limit: number): Passage[] {
  const byYear = new Map<number, Passage[]>();
  for (const p of passages) {
    const list = byYear.get(p.fiscalYear);
    if (list) list.push(p);
    else byYear.set(p.fiscalYear, [p]);
  }
  const queues = [...byYear.values()];
  const out: Passage[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const q of queues) {
      const p = q[round];
      if (p && out.length < limit) {
        out.push(p);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

/** Puts each following table right after the passage that introduces it, skipping any already chosen. */
export function insertTables(
  chosen: readonly Passage[],
  tables: ReadonlyMap<number, Passage>,
  maxAdded = MAX_ADDED_TABLES,
): Passage[] {
  const present = new Set(chosen.map((p) => p.id));
  const out: Passage[] = [];
  let added = 0;
  for (const p of chosen) {
    out.push(p);
    const table = tables.get(p.id);
    if (table && !present.has(table.id) && added < maxAdded) {
      out.push(table);
      present.add(table.id);
      added++;
    }
  }
  return out;
}

export interface RetrieveDeps extends SearchDeps {
  /** For each passage id, the table that directly follows it in the same section, if any. */
  nextTables: (passageIds: readonly number[]) => Promise<Map<number, Passage>>;
}

export async function retrievePassages(question: string, options: SearchOptions, deps: RetrieveDeps): Promise<Passage[]> {
  const q = validateSearch(question, options);
  const limit = options.limit ?? 8;
  const years: number[] = [];
  for (let y = options.fromYear; y <= options.toYear; y++) years.push(y);
  const slots = slotsFor(limit, years.length);
  const perYear = years.length <= 1 ? slots : Math.ceil(slots / years.length);

  const embedding = await embedQuestion(q, deps.voyage);
  const depth = Math.max(perYear, MIN_CANDIDATES);
  const lists = await Promise.all(
    years.map(async (y) =>
      (await searchWithEmbedding(q, embedding, { ...options, fromYear: y, toYear: y, limit: depth }, deps.rpc)).slice(0, perYear),
    ),
  );
  const chosen = years.length <= 1 ? (lists[0] ?? []) : interleaveByYear(lists.flat(), slots);
  if (chosen.length === 0) return chosen;
  return insertTables(chosen, await deps.nextTables(chosen.map((p) => p.id)));
}
