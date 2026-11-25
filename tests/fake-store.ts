import type {
  ChunkToEmbed,
  CompanyRow,
  FactRow,
  FilingRow,
  IngestStore,
  RatioRow,
  RedFlagRow,
  RunUpdate,
  SectionWithChunks,
  StoredFiling,
} from "@/lib/ingest/store";

/** In-memory IngestStore for tests: behaves like the real upserts, keyed the same way. */
export function createFakeStore(): IngestStore & {
  companies: Map<string, CompanyRow & { id: number }>;
  filings: Map<string, FilingRow & { storage_path?: string | null; status?: string }>;
  documents: Map<string, Uint8Array>;
  /** Parsed text by filing id. */
  filingText: Map<number, SectionWithChunks[]>;
  facts: Map<string, FactRow>;
  ratios: Map<string, RatioRow>;
  redFlags: RedFlagRow[];
  runs: Map<number, { ticker: string; params: Record<string, unknown> } & RunUpdate>;
  /** Saved embeddings by passage id, with their model. */
  embeddings: Map<number, { embedding: readonly number[]; model: string }>;
} {
  let redFlags: RedFlagRow[] = [];
  const companies = new Map<string, CompanyRow & { id: number }>();
  const filings = new Map<string, FilingRow & { storage_path?: string | null; status?: string }>();
  const documents = new Map<string, Uint8Array>();
  const filingText = new Map<number, SectionWithChunks[]>();
  // Stable fake ids for filings, by accession number.
  const filingIds = new Map<string, number>();
  const idFor = (accession: string) => {
    if (!filingIds.has(accession)) filingIds.set(accession, filingIds.size + 1);
    return filingIds.get(accession) ?? 0;
  };
  const facts = new Map<string, FactRow>();
  const ratios = new Map<string, RatioRow>();
  const runs = new Map<number, { ticker: string; params: Record<string, unknown> } & RunUpdate>();
  const embeddings = new Map<number, { embedding: readonly number[]; model: string }>();
  // Fake passage ids: filing id, section position and passage index packed into one number.
  const chunkId = (filingId: number, sectionIndex: number, chunkIndex: number) =>
    filingId * 1_000_000 + sectionIndex * 10_000 + chunkIndex;
  const filingOfChunk = (id: number) => Math.floor(id / 1_000_000);
  let nextCompanyId = 1;
  let nextRunId = 1;

  return {
    companies,
    filings,
    documents,
    filingText,
    facts,
    ratios,
    get redFlags() {
      return redFlags;
    },
    runs,
    embeddings,
    async startRun(ticker, params) {
      const id = nextRunId++;
      runs.set(id, { ticker, params, status: "running" });
      return id;
    },
    async updateRun(runId, update) {
      const run = runs.get(runId);
      if (!run) throw new Error(`no run ${runId}`);
      runs.set(runId, { ...run, ...update });
    },
    async upsertCompany(row) {
      const existing = companies.get(row.cik);
      const id = existing?.id ?? nextCompanyId++;
      companies.set(row.cik, { ...row, id });
      return id;
    },
    async upsertFilings(rows) {
      for (const row of rows) filings.set(row.accession_no, { ...filings.get(row.accession_no), ...row });
      return rows.length;
    },
    async upsertFacts(rows) {
      for (const row of rows) {
        facts.set(`${row.company_id}|${row.concept}|${row.unit}|${row.period_start ?? ""}|${row.period_end}`, row);
      }
      return rows.length;
    },
    async upsertRatios(rows) {
      for (const row of rows) ratios.set(`${row.company_id}|${row.fiscal_year}|${row.metric}`, row);
      return rows.length;
    },
    async replaceRedFlags(companyId, rows) {
      redFlags = [...redFlags.filter((f) => f.company_id !== companyId), ...rows];
      return rows.length;
    },
    async getFilings(companyId) {
      return [...filings.values()]
        .filter((f) => f.company_id === companyId)
        .map(
          (f): StoredFiling => ({
            id: idFor(f.accession_no),
            accession_no: f.accession_no,
            fiscal_year: f.fiscal_year,
            primary_document: f.primary_document,
            storage_path: f.storage_path ?? null,
            status: f.status ?? "pending",
          }),
        );
    },
    async documentExists(path) {
      return documents.has(path);
    },
    async uploadDocument(path, bytes) {
      if (documents.has(path)) return "exists";
      documents.set(path, bytes);
      return "uploaded";
    },
    async markDownloaded(accessionNo, storagePath) {
      const f = filings.get(accessionNo);
      if (f) filings.set(accessionNo, { ...f, storage_path: storagePath, status: "downloaded" });
    },
    async downloadDocument(path) {
      const bytes = documents.get(path);
      if (!bytes) throw new Error(`no document at ${path}`);
      return bytes;
    },
    async replaceFilingText(filing, sections) {
      // Like the real cascade: replacing passages drops their embeddings.
      for (const id of [...embeddings.keys()]) if (filingOfChunk(id) === filing.id) embeddings.delete(id);
      filingText.set(filing.id, sections.map((s) => ({ ...s, chunks: [...s.chunks] })));
      return sections.reduce((n, s) => n + s.chunks.length, 0);
    },
    async markParsed(filingId) {
      for (const [accession, f] of filings) {
        if (idFor(accession) === filingId) filings.set(accession, { ...f, status: "parsed" });
      }
    },
    async getChunksToEmbed(filingId) {
      const sections = filingText.get(filingId) ?? [];
      return sections.flatMap((s, si) =>
        s.chunks
          .map(
            (c): ChunkToEmbed => ({
              id: chunkId(filingId, si, c.chunk_index),
              item: s.item,
              section_title: s.title,
              heading: c.heading,
              content: c.content,
              token_count: c.token_count,
            }),
          )
          .filter((c) => !embeddings.has(c.id)),
      );
    },
    async saveEmbeddings(rows, model) {
      for (const row of rows) embeddings.set(row.id, { embedding: row.embedding, model });
      return rows.length;
    },
    async markEmbedded(filingId) {
      for (const [accession, f] of filings) {
        if (idFor(accession) === filingId) filings.set(accession, { ...f, status: "embedded" });
      }
    },
  };
}
