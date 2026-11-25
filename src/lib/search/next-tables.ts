/**
 * Database lookup for retrieve.ts: the table passage that directly follows
 * each given passage in its section (chunk_index + 1, kind = 'table').
 * Two small reads; works with either Supabase key (chunks are public).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Passage } from "./hybrid.ts";

interface ChunkRow {
  id: number | string;
  section_id: number | string;
  chunk_index: number;
  filing_id: number | string;
  fiscal_year: number;
  item: string;
  heading: string | null;
  kind: string;
  page_start: number;
  page_end: number;
  content: string;
}

export function createNextTablesLookup(db: SupabaseClient) {
  return async (passageIds: readonly number[]): Promise<Map<number, Passage>> => {
    const result = new Map<number, Passage>();
    if (passageIds.length === 0) return result;
    const { data: chosen, error } = await db.from("chunks").select("id, section_id, chunk_index").in("id", [...passageIds]);
    if (error) throw new Error(`Reading passages failed: ${error.message}`);
    const positions = (chosen ?? []) as { id: number | string; section_id: number | string; chunk_index: number }[];
    if (positions.length === 0) return result;

    const { data: tables, error: tableError } = await db
      .from("chunks")
      .select("id, section_id, chunk_index, filing_id, fiscal_year, item, heading, kind, page_start, page_end, content")
      .in("section_id", [...new Set(positions.map((p) => Number(p.section_id)))])
      .in("chunk_index", [...new Set(positions.map((p) => p.chunk_index + 1))])
      .eq("kind", "table");
    if (tableError) throw new Error(`Reading tables failed: ${tableError.message}`);
    const byPosition = new Map(((tables ?? []) as ChunkRow[]).map((t) => [`${t.section_id}:${t.chunk_index}`, t]));

    for (const p of positions) {
      const t = byPosition.get(`${p.section_id}:${p.chunk_index + 1}`);
      if (!t) continue;
      result.set(Number(p.id), {
        id: Number(t.id),
        filingId: Number(t.filing_id),
        fiscalYear: t.fiscal_year,
        item: t.item,
        heading: t.heading,
        kind: "table",
        pageStart: t.page_start,
        pageEnd: t.page_end,
        content: t.content,
        // Added for context, not ranked by search.
        semanticRank: null,
        keywordRank: null,
        score: 0,
      });
    }
    return result;
  };
}
