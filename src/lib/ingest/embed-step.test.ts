import { describe, expect, it } from "vitest";
import { ingestEmbeddings } from "@/lib/ingest/embed-step";
import type { ChunkRow, SectionWithChunks } from "@/lib/ingest/store";
import { EMBEDDING_DIMENSIONS, type InputType, type VoyageClient } from "@/lib/voyage/client";
import { createFakeStore } from "../../../tests/fake-store";

/** A Voyage stand-in that records what it was sent and returns fixed vectors. */
function fakeVoyage(options: { failOnCall?: number } = {}): VoyageClient & { calls: { texts: string[]; type: InputType }[] } {
  const calls: { texts: string[]; type: InputType }[] = [];
  let tokens = 0;
  return {
    calls,
    model: "voyage-4",
    get requestCount() {
      return calls.length;
    },
    get tokenCount() {
      return tokens;
    },
    async embed(texts, type) {
      calls.push({ texts: [...texts], type });
      if (calls.length === options.failOnCall) throw new Error("Voyage returned HTTP 500");
      tokens += texts.length * 10;
      return { embeddings: texts.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0.1)), tokens: texts.length * 10 };
    },
  };
}

const chunk = (i: number, tokens = 100): ChunkRow => ({
  chunk_index: i,
  heading: i === 0 ? "Overview" : null,
  kind: "text",
  page_start: 1,
  page_end: 1,
  content: `Passage ${i}.`,
  word_count: 2,
  token_count: tokens,
});

const section = (item: string, count: number, tokens?: number): SectionWithChunks => ({
  item,
  title: `TITLE ${item}`,
  page_start: 1,
  page_end: 2,
  word_count: 10,
  chunks: Array.from({ length: count }, (_, i) => chunk(i, tokens)),
});

/** Two parsed filings for company 1 (FY2024, FY2025) and one pending FY2023. */
async function setup() {
  const store = createFakeStore();
  const add = (accession: string, fiscalYear: number, status: string) =>
    store.filings.set(accession, {
      company_id: 1,
      accession_no: accession,
      form: "10-K",
      fiscal_year: fiscalYear,
      period_end: `${fiscalYear + 1}-01-31`,
      filed_at: `${fiscalYear + 1}-03-15`,
      primary_document: "x.htm",
      storage_path: status === "pending" ? null : `X/${fiscalYear}.htm`,
      status,
    });
  add("0000000001-25-000001", 2024, "parsed");
  add("0000000001-26-000001", 2025, "parsed");
  add("0000000001-24-000001", 2023, "pending");
  const filings = await store.getFilings(1);
  const id = (year: number) => filings.find((f) => f.fiscal_year === year)!.id;
  await store.replaceFilingText({ id: id(2024), company_id: 1, fiscal_year: 2024 }, [section("1A", 3), section("7", 2)]);
  await store.replaceFilingText({ id: id(2025), company_id: 1, fiscal_year: 2025 }, [section("7", 4)]);
  return { store, id };
}

describe("ingestEmbeddings", () => {
  it("embeds every passage in the window as a document, with its section prefix, then marks filings embedded", async () => {
    const { store } = await setup();
    const voyage = fakeVoyage();
    const result = await ingestEmbeddings(store, voyage, 1, [2023, 2024, 2025]);

    expect(result).toMatchObject({ skipped: false, embedded: 9, filingsEmbedded: 2, requests: 2, tokens: 90 });
    expect(voyage.calls.every((c) => c.type === "document")).toBe(true);
    expect(voyage.calls[0]!.texts[0]).toBe("Item 1A: TITLE 1A — Overview\n\nPassage 0.");
    expect(store.embeddings.size).toBe(9);
    expect([...store.embeddings.values()].every((e) => e.model === "voyage-4")).toBe(true);
    const statuses = [...store.filings.values()].map((f) => `${f.fiscal_year}:${f.status}`).sort();
    expect(statuses).toEqual(["2023:pending", "2024:embedded", "2025:embedded"]);
  });

  it("sends nothing on a second run", async () => {
    const { store } = await setup();
    await ingestEmbeddings(store, fakeVoyage(), 1, [2024, 2025]);
    const again = fakeVoyage();
    expect(await ingestEmbeddings(store, again, 1, [2024, 2025])).toMatchObject({ embedded: 0, filingsAlreadyEmbedded: 2 });
    expect(again.calls).toHaveLength(0);
  });

  it("only touches filings in the window", async () => {
    const { store } = await setup();
    const voyage = fakeVoyage();
    expect(await ingestEmbeddings(store, voyage, 1, [2025])).toMatchObject({ embedded: 4, filingsEmbedded: 1 });
  });

  it("re-embeds passages replaced by a re-parse", async () => {
    const { store, id } = await setup();
    await ingestEmbeddings(store, fakeVoyage(), 1, [2025]);
    await store.replaceFilingText({ id: id(2025), company_id: 1, fiscal_year: 2025 }, [section("7", 2)]);
    await store.markParsed(id(2025));
    expect(await ingestEmbeddings(store, fakeVoyage(), 1, [2025])).toMatchObject({ embedded: 2, filingsEmbedded: 1 });
  });

  it("splits large filings into several requests", async () => {
    const { store, id } = await setup();
    // 300 passages of 400 estimated tokens: 120,000 tokens → batches of at most 50,000 (125 passages).
    await store.replaceFilingText({ id: id(2025), company_id: 1, fiscal_year: 2025 }, [section("7", 300, 400)]);
    const voyage = fakeVoyage();
    await ingestEmbeddings(store, voyage, 1, [2025]);
    expect(voyage.calls.map((c) => c.texts.length)).toEqual([125, 125, 50]);
  });

  it("keeps the batches saved before a failure and leaves the filing unmarked", async () => {
    const { store, id } = await setup();
    await store.replaceFilingText({ id: id(2025), company_id: 1, fiscal_year: 2025 }, [section("7", 300, 400)]);
    await expect(ingestEmbeddings(store, fakeVoyage({ failOnCall: 2 }), 1, [2025])).rejects.toThrow("HTTP 500");
    expect(store.embeddings.size).toBe(125);
    expect([...store.filings.values()].find((f) => f.fiscal_year === 2025)?.status).toBe("parsed");
    // The next run picks up only what's left.
    expect(await ingestEmbeddings(store, fakeVoyage(), 1, [2025])).toMatchObject({ embedded: 175 });
  });

  it("skips with a warning when there is no Voyage key", async () => {
    const { store } = await setup();
    expect(await ingestEmbeddings(store, null, 1, [2025])).toMatchObject({
      skipped: true,
      embedded: 0,
      warnings: ["VOYAGE_API_KEY is not set, so passages were not embedded"],
    });
  });
});
