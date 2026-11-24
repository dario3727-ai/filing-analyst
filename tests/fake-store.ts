import type { CompanyRow, FactRow, FilingRow, IngestStore, RatioRow, RunUpdate } from "@/lib/ingest/store";

/** In-memory IngestStore for tests: behaves like the real upserts, keyed the same way. */
export function createFakeStore(): IngestStore & {
  companies: Map<string, CompanyRow & { id: number }>;
  filings: Map<string, FilingRow>;
  facts: Map<string, FactRow>;
  ratios: Map<string, RatioRow>;
  runs: Map<number, { ticker: string; params: Record<string, unknown> } & RunUpdate>;
} {
  const companies = new Map<string, CompanyRow & { id: number }>();
  const filings = new Map<string, FilingRow>();
  const facts = new Map<string, FactRow>();
  const ratios = new Map<string, RatioRow>();
  const runs = new Map<number, { ticker: string; params: Record<string, unknown> } & RunUpdate>();
  let nextCompanyId = 1;
  let nextRunId = 1;

  return {
    companies,
    filings,
    facts,
    ratios,
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
  };
}
