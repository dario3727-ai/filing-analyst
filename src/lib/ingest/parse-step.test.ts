import { describe, expect, it } from "vitest";
import { ingestParse } from "@/lib/ingest/parse-step";
import type { TenK } from "@/lib/sec/submissions";
import { loadFilingBytes } from "../../../tests/filing-fixtures";
import { createFakeStore } from "../../../tests/fake-store";

const WMT_2025: TenK = {
  accessionNumber: "0000104169-26-000010",
  fiscalYear: 2025,
  periodEnd: "2026-01-31",
  filedAt: "2026-03-13",
  primaryDocument: "wmt-20260131.htm",
};

/** A store holding Walmart's real fiscal-2025 10-K, already downloaded. */
function storeWithWalmart(bytes = loadFilingBytes("WMT", 2025)) {
  const store = createFakeStore();
  store.filings.set(WMT_2025.accessionNumber, {
    company_id: 1,
    accession_no: WMT_2025.accessionNumber,
    form: "10-K",
    fiscal_year: 2025,
    period_end: WMT_2025.periodEnd,
    filed_at: WMT_2025.filedAt,
    primary_document: WMT_2025.primaryDocument,
    storage_path: "WMT/2025.htm",
    status: "downloaded",
  });
  store.documents.set("WMT/2025.htm", bytes);
  return store;
}

describe("ingestParse", () => {
  it("parses a downloaded 10-K into five sections and their passages, then marks it parsed", async () => {
    const store = storeWithWalmart();
    const result = await ingestParse(store, 1, [WMT_2025]);

    expect(result).toMatchObject({ parsed: 1, skipped: 0, sections: 5, warnings: [] });
    expect(result.chunks).toBeGreaterThan(200);
    const text = [...store.filingText.values()][0] ?? [];
    expect(text.map((s) => s.item)).toEqual(["1", "1A", "7", "7A", "8"]);
    expect(text.find((s) => s.item === "1A")?.chunks[0]).toMatchObject({ chunk_index: 0, kind: "text" });
    expect(store.filings.get(WMT_2025.accessionNumber)?.status).toBe("parsed");
  });

  it("skips filings already parsed, unless asked to re-parse", async () => {
    const store = storeWithWalmart();
    await ingestParse(store, 1, [WMT_2025]);
    expect(await ingestParse(store, 1, [WMT_2025])).toMatchObject({ parsed: 0, skipped: 1 });
    expect(await ingestParse(store, 1, [WMT_2025], { reparse: true })).toMatchObject({ parsed: 1, skipped: 0 });
  });

  it("stores what it finds and warns about missing items, instead of failing", async () => {
    const html = "<p>Item 1. Business</p><p>We sell things. We sell many things in many stores.</p><p>Item 2. Properties</p>";
    const store = storeWithWalmart(new TextEncoder().encode(html));
    const result = await ingestParse(store, 1, [WMT_2025]);
    expect(result).toMatchObject({ parsed: 1, sections: 1, warnings: ["FY2025: Item 1A, Item 7, Item 7A, Item 8 not found"] });
  });

  it("warns about a 10-K that hasn't been downloaded", async () => {
    const store = createFakeStore();
    const result = await ingestParse(store, 1, [WMT_2025]);
    expect(result).toMatchObject({ parsed: 0, warnings: ["FY2025: not downloaded, so not parsed"] });
  });
});
