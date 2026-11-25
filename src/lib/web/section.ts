/**
 * The 10-K section a cited passage belongs to, for the citation side panel:
 * filing details, the section's title and pages, and all its passages in
 * order (decisions 2026-11-24). 10-K text is public, so the read-only key is
 * enough. `toSectionView` is pure; `loadSection` does the reads.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { filingDocumentUrl } from "../sec/urls.ts";

/** A section passage shown in the panel. */
export interface SectionPassage {
  id: number;
  chunkIndex: number;
  kind: "text" | "table";
  heading: string | null;
  pageStart: number;
  pageEnd: number;
  content: string;
}

export interface SectionView {
  company: { name: string; ticker: string };
  filing: { fiscalYear: number; form: string; periodEnd: string; filedAt: string; secUrl: string };
  section: { item: string; title: string; pageStart: number; pageEnd: number };
  passages: SectionPassage[];
}

export interface SectionRows {
  section: { item: string; title: string; page_start: number; page_end: number };
  filing: { fiscal_year: number; form: string; period_end: string; filed_at: string; accession_no: string; primary_document: string };
  company: { cik: string; name: string; ticker: string };
  chunks: { id: number | string; chunk_index: number; kind: string; heading: string | null; page_start: number; page_end: number; content: string }[];
}

export function toSectionView(rows: SectionRows): SectionView {
  return {
    company: { name: rows.company.name, ticker: rows.company.ticker },
    filing: {
      fiscalYear: rows.filing.fiscal_year,
      form: rows.filing.form,
      periodEnd: rows.filing.period_end,
      filedAt: rows.filing.filed_at,
      secUrl: filingDocumentUrl(rows.company.cik, rows.filing.accession_no, rows.filing.primary_document),
    },
    section: {
      item: rows.section.item,
      title: rows.section.title,
      pageStart: rows.section.page_start,
      pageEnd: rows.section.page_end,
    },
    passages: [...rows.chunks]
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map((c) => ({
        id: Number(c.id),
        chunkIndex: c.chunk_index,
        kind: c.kind === "table" ? "table" : "text",
        heading: c.heading,
        pageStart: c.page_start,
        pageEnd: c.page_end,
        content: c.content,
      })),
  };
}

/** "123" → 123; anything that isn't a positive whole number → undefined. */
export function parsePassageId(value: string | null): number | undefined {
  if (value === null || !/^\d{1,12}$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 ? n : undefined;
}

/** Reads the section holding `passageId`; null if there is no such passage. */
export async function loadSection(db: SupabaseClient, passageId: number): Promise<SectionView | null> {
  const fail = (what: string, message: string): never => {
    throw new Error(`Reading ${what} failed: ${message}`);
  };
  const { data: chunk, error } = await db.from("chunks").select("section_id").eq("id", passageId).maybeSingle();
  if (error) fail("passage", error.message);
  if (!chunk) return null;
  const sectionId = Number((chunk as { section_id: number | string }).section_id);

  const [sectionRes, chunksRes] = await Promise.all([
    db
      .from("sections")
      .select(
        "item, title, page_start, page_end, filings(fiscal_year, form, period_end, filed_at, accession_no, primary_document, companies(cik, name, ticker))",
      )
      .eq("id", sectionId)
      .single(),
    db
      .from("chunks")
      .select("id, chunk_index, kind, heading, page_start, page_end, content")
      .eq("section_id", sectionId)
      .order("chunk_index")
      .limit(1000),
  ]);
  if (sectionRes.error) fail("section", sectionRes.error.message);
  if (chunksRes.error) fail("section passages", chunksRes.error.message);

  // Untyped supabase-js rows; the select above names exactly these columns.
  const s = sectionRes.data as unknown as SectionRows["section"] & {
    filings: SectionRows["filing"] & { companies: SectionRows["company"] };
  };
  const { companies, ...filing } = s.filings;
  return toSectionView({
    section: { item: s.item, title: s.title, page_start: s.page_start, page_end: s.page_end },
    filing,
    company: companies,
    chunks: (chunksRes.data ?? []) as unknown as SectionRows["chunks"],
  });
}
