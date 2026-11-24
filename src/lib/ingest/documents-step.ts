/**
 * Ingest step 5: save each 10-K in the window to Supabase Storage, never
 * downloading the same filing twice (CLAUDE.md):
 *   1. filings.storage_path set → already saved, skip.
 *   2. file already in Storage (an earlier run crashed before updating the
 *      database) → record it, no download ("repaired").
 *   3. otherwise download the raw bytes from the SEC and upload them.
 * Bytes are stored exactly as sent; decoding happens in the parser.
 */
import type { SecClient } from "../sec/client.ts";
import type { TenK } from "../sec/submissions.ts";
import { filingDocumentUrl } from "../sec/urls.ts";
import type { IngestStore } from "./store.ts";

/** The raw-filings bucket's per-file limit (free plan maximum). */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** Path convention from docs/database-schema.md: {ticker}/{fiscal_year}.htm */
export function storagePathFor(ticker: string, fiscalYear: number): string {
  return `${ticker.toUpperCase()}/${fiscalYear}.htm`;
}

export type DocumentOutcome = "already_saved" | "repaired" | "downloaded";

export interface DocumentsStepResult {
  downloaded: number;
  alreadySaved: number;
  repaired: number;
  bytesDownloaded: number;
  documents: { fiscalYear: number; path: string; outcome: DocumentOutcome; bytes?: number }[];
}

export async function ingestDocuments(
  sec: SecClient,
  store: IngestStore,
  companyId: number,
  ticker: string,
  cik: string,
  tenKs: readonly TenK[],
): Promise<DocumentsStepResult> {
  const stored = new Map((await store.getFilings(companyId)).map((f) => [f.accession_no, f]));
  const result: DocumentsStepResult = { downloaded: 0, alreadySaved: 0, repaired: 0, bytesDownloaded: 0, documents: [] };

  for (const tenK of tenKs) {
    const path = storagePathFor(ticker, tenK.fiscalYear);
    const row = stored.get(tenK.accessionNumber);

    if (row?.storage_path) {
      result.alreadySaved++;
      result.documents.push({ fiscalYear: tenK.fiscalYear, path: row.storage_path, outcome: "already_saved" });
      continue;
    }

    if (await store.documentExists(path)) {
      await store.markDownloaded(tenK.accessionNumber, path);
      result.repaired++;
      result.documents.push({ fiscalYear: tenK.fiscalYear, path, outcome: "repaired" });
      continue;
    }

    const bytes = await sec.getBytes(filingDocumentUrl(cik, tenK.accessionNumber, tenK.primaryDocument));
    if (bytes.length === 0) throw new Error(`SEC returned an empty document for ${tenK.primaryDocument}`);
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      throw new Error(
        `${tenK.primaryDocument} is ${(bytes.length / 1e6).toFixed(1)} MB, over the ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB storage limit`,
      );
    }
    // "exists" would mean another run uploaded it in the meantime; either way it's saved now.
    await store.uploadDocument(path, bytes);
    await store.markDownloaded(tenK.accessionNumber, path);
    result.downloaded++;
    result.bytesDownloaded += bytes.length;
    result.documents.push({ fiscalYear: tenK.fiscalYear, path, outcome: "downloaded", bytes: bytes.length });
  }
  return result;
}
