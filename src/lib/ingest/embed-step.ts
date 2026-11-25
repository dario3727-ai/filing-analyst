/**
 * Ingest step 7: Voyage embeddings for every stored passage that has none,
 * in the filings of the ingestion window (decisions 2026-11-24).
 * Re-running embeds nothing new: only passages with an empty embedding are
 * sent. A filing is marked `embedded` once all its passages have one.
 * Without VOYAGE_API_KEY the step is skipped with a warning, never guessed.
 */
import { embeddingText, planBatches, type PassageForEmbedding } from "../voyage/batches.ts";
import type { VoyageClient } from "../voyage/client.ts";
import type { IngestStore } from "./store.ts";

export interface EmbedStepResult {
  skipped: boolean;
  /** Passages embedded in this run. */
  embedded: number;
  /** Filings that became fully embedded in this run. */
  filingsEmbedded: number;
  /** Filings that were already fully embedded. */
  filingsAlreadyEmbedded: number;
  /** Tokens Voyage counted in this run. */
  tokens: number;
  requests: number;
  warnings: string[];
}

const EMBEDDABLE = new Set(["parsed", "embedded"]);

export async function ingestEmbeddings(
  store: IngestStore,
  voyage: VoyageClient | null,
  companyId: number,
  windowYears: readonly number[],
): Promise<EmbedStepResult> {
  const result: EmbedStepResult = {
    skipped: false,
    embedded: 0,
    filingsEmbedded: 0,
    filingsAlreadyEmbedded: 0,
    tokens: 0,
    requests: 0,
    warnings: [],
  };
  if (!voyage) {
    return { ...result, skipped: true, warnings: ["VOYAGE_API_KEY is not set, so passages were not embedded"] };
  }
  const startRequests = voyage.requestCount;
  const startTokens = voyage.tokenCount;
  const years = new Set(windowYears);
  const filings = (await store.getFilings(companyId))
    .filter((f) => years.has(f.fiscal_year) && EMBEDDABLE.has(f.status))
    .sort((a, b) => a.fiscal_year - b.fiscal_year);

  for (const filing of filings) {
    const chunks = await store.getChunksToEmbed(filing.id);
    if (chunks.length === 0) {
      if (filing.status === "embedded") result.filingsAlreadyEmbedded++;
      else {
        // Parsed, and every passage already has an embedding (e.g. a run stopped just before marking it).
        await store.markEmbedded(filing.id);
        result.filingsEmbedded++;
      }
      continue;
    }
    const passages: PassageForEmbedding[] = chunks.map((c) => ({
      id: c.id,
      item: c.item,
      sectionTitle: c.section_title,
      heading: c.heading,
      content: c.content,
      tokenCount: c.token_count,
    }));
    for (const batch of planBatches(passages)) {
      const { embeddings } = await voyage.embed(batch.map(embeddingText), "document");
      // Saved per batch, so a failure later keeps what's done and the next run continues from there.
      result.embedded += await store.saveEmbeddings(
        batch.map((p, i) => ({ id: p.id, embedding: embeddings[i]! })),
        voyage.model,
      );
    }
    await store.markEmbedded(filing.id);
    result.filingsEmbedded++;
  }

  result.requests = voyage.requestCount - startRequests;
  result.tokens = voyage.tokenCount - startTokens;
  return result;
}
