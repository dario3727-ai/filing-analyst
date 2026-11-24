import type { CompanyRow, FilingRow, IngestStore, RunUpdate } from "@/lib/ingest/store";

/** In-memory IngestStore for tests: behaves like the real upserts, keyed the same way. */
export function createFakeStore(): IngestStore & {
  companies: Map<string, CompanyRow & { id: number }>;
  filings: Map<string, FilingRow>;
  runs: Map<number, { ticker: string; params: Record<string, unknown> } & RunUpdate>;
} {
  const companies = new Map<string, CompanyRow & { id: number }>();
  const filings = new Map<string, FilingRow>();
  const runs = new Map<number, { ticker: string; params: Record<string, unknown> } & RunUpdate>();
  let nextCompanyId = 1;
  let nextRunId = 1;

  return {
    companies,
    filings,
    runs,
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
  };
}
