import { describe, expect, it } from "vitest";
import { ingestDocuments, MAX_DOCUMENT_BYTES, storagePathFor } from "@/lib/ingest/documents-step";
import { createSecClient } from "@/lib/sec/client";
import type { TenK } from "@/lib/sec/submissions";
import { createFakeClock } from "../../../tests/fake-clock";
import { createFakeStore } from "../../../tests/fake-store";

const CIK = "0000104169";
const tenK = (fiscalYear: number, n: number): TenK => ({
  accessionNumber: `0000104169-${String(fiscalYear + 1).slice(2)}-0000${n}0`,
  fiscalYear,
  periodEnd: `${fiscalYear + 1}-01-31`,
  filedAt: `${fiscalYear + 1}-03-14`,
  primaryDocument: `wmt-${fiscalYear + 1}0131.htm`,
});
const TEN_KS = [tenK(2024, 1), tenK(2025, 2)];

/** Fake SEC that serves bytes for any Archives URL and counts downloads. */
function fakeSec(size = 1000) {
  const downloads: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    downloads.push(String(input));
    return new Response(new Uint8Array(size).fill(0x41));
  };
  return { sec: createSecClient({ userAgent: "Test test@example.org", fetchFn, clock: createFakeClock() }), downloads };
}

/** A store that already has the two filings rows from the submissions step. */
function storeWithFilings() {
  const store = createFakeStore();
  for (const t of TEN_KS) {
    store.filings.set(t.accessionNumber, {
      company_id: 1,
      accession_no: t.accessionNumber,
      form: "10-K",
      fiscal_year: t.fiscalYear,
      period_end: t.periodEnd,
      filed_at: t.filedAt,
      primary_document: t.primaryDocument,
    });
  }
  return store;
}

describe("ingestDocuments", () => {
  it("downloads each 10-K once, uploads it to {ticker}/{fiscal_year}.htm and marks it downloaded", async () => {
    const { sec, downloads } = fakeSec();
    const store = storeWithFilings();
    const result = await ingestDocuments(sec, store, 1, "WMT", CIK, TEN_KS);

    expect(result).toMatchObject({ downloaded: 2, alreadySaved: 0, repaired: 0, bytesDownloaded: 2000 });
    expect(downloads).toEqual([
      "https://www.sec.gov/Archives/edgar/data/104169/000010416925000010/wmt-20250131.htm",
      "https://www.sec.gov/Archives/edgar/data/104169/000010416926000020/wmt-20260131.htm",
    ]);
    expect([...store.documents.keys()]).toEqual(["WMT/2024.htm", "WMT/2025.htm"]);
    expect(store.filings.get(TEN_KS[0]?.accessionNumber ?? "")).toMatchObject({
      storage_path: "WMT/2024.htm",
      status: "downloaded",
    });
  });

  it("never downloads the same filing twice: a second run only skips", async () => {
    const store = storeWithFilings();
    await ingestDocuments(fakeSec().sec, store, 1, "WMT", CIK, TEN_KS);
    const second = fakeSec();
    const result = await ingestDocuments(second.sec, store, 1, "WMT", CIK, TEN_KS);
    expect(result).toMatchObject({ downloaded: 0, alreadySaved: 2 });
    expect(second.downloads).toEqual([]);
  });

  it("records a file already in Storage without downloading it (a run that crashed mid-way)", async () => {
    const store = storeWithFilings();
    store.documents.set("WMT/2024.htm", new Uint8Array([1, 2, 3])); // uploaded, but the database wasn't updated
    const { sec, downloads } = fakeSec();
    const result = await ingestDocuments(sec, store, 1, "WMT", CIK, TEN_KS);
    expect(result).toMatchObject({ downloaded: 1, repaired: 1 });
    expect(downloads).toHaveLength(1);
    expect(store.filings.get(TEN_KS[0]?.accessionNumber ?? "")?.status).toBe("downloaded");
  });

  it("refuses a document over the bucket's size limit, before uploading", async () => {
    const store = storeWithFilings();
    const { sec } = fakeSec(MAX_DOCUMENT_BYTES + 1);
    await expect(ingestDocuments(sec, store, 1, "WMT", CIK, TEN_KS.slice(0, 1))).rejects.toThrow(/over the 50 MB storage limit/);
    expect(store.documents.size).toBe(0);
  });

  it("builds storage paths as {TICKER}/{fiscal_year}.htm", () => {
    expect(storagePathFor("wmt", 2025)).toBe("WMT/2025.htm");
  });
});
