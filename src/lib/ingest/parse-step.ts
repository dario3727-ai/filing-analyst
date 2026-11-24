/**
 * Ingest step 6: stored 10-K → sections and chunks.
 * For each 10-K in the window that's downloaded but not yet parsed (or all
 * of them with --reparse): read it from Storage, parse the target items,
 * cut passages, replace the filing's rows, then mark it parsed. A filing is
 * marked parsed only after its rows are written, so an interrupted run
 * simply redoes it next time.
 */
import { chunkSection } from "../filings/chunks.ts";
import { parseFiling } from "../filings/sections.ts";
import type { TenK } from "../sec/submissions.ts";
import type { IngestStore, SectionWithChunks } from "./store.ts";

export interface ParseStepResult {
  parsed: number;
  skipped: number;
  sections: number;
  chunks: number;
  warnings: string[];
}

const ALREADY_PARSED = new Set(["parsed", "embedded"]);

export async function ingestParse(
  store: IngestStore,
  companyId: number,
  tenKs: readonly TenK[],
  options: { reparse?: boolean } = {},
): Promise<ParseStepResult> {
  const filings = new Map((await store.getFilings(companyId)).map((f) => [f.accession_no, f]));
  const result: ParseStepResult = { parsed: 0, skipped: 0, sections: 0, chunks: 0, warnings: [] };

  for (const tenK of tenKs) {
    const filing = filings.get(tenK.accessionNumber);
    if (!filing?.storage_path) {
      result.warnings.push(`FY${tenK.fiscalYear}: not downloaded, so not parsed`);
      continue;
    }
    if (ALREADY_PARSED.has(filing.status) && !options.reparse) {
      result.skipped++;
      continue;
    }

    const parsed = parseFiling(await store.downloadDocument(filing.storage_path));
    if (parsed.missing.length > 0) {
      result.warnings.push(`FY${tenK.fiscalYear}: Item ${parsed.missing.join(", Item ")} not found`);
    }
    for (const w of parsed.warnings) result.warnings.push(`FY${tenK.fiscalYear}: ${w}`);

    const sections: SectionWithChunks[] = parsed.sections.map((s) => ({
      item: s.item,
      title: s.title,
      page_start: s.pageStart,
      page_end: s.pageEnd,
      word_count: s.wordCount,
      chunks: chunkSection(s).map((c) => ({
        chunk_index: c.chunkIndex,
        heading: c.heading,
        kind: c.kind,
        page_start: c.pageStart,
        page_end: c.pageEnd,
        content: c.text,
        word_count: c.wordCount,
        token_count: c.tokenCount,
      })),
    }));

    const written = await store.replaceFilingText(
      { id: filing.id, company_id: companyId, fiscal_year: filing.fiscal_year },
      sections,
    );
    await store.markParsed(filing.id);
    result.parsed++;
    result.sections += sections.length;
    result.chunks += written;
  }
  return result;
}
