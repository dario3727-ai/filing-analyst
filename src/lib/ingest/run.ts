/**
 * One ingest run for one company, logged in ingestion_runs from start to
 * finish, including failures. `step` records the last step completed, so a
 * failed run shows how far it got.
 * Steps: submissions → company facts → ratios → red flags → documents → parse → embed.
 */
import type { SecClient } from "../sec/client.ts";
import type { VoyageClient } from "../voyage/client.ts";
import { ingestEmbeddings, type EmbedStepResult } from "./embed-step.ts";
import type { IngestArgs } from "./args.ts";
import { ingestDocuments, type DocumentsStepResult } from "./documents-step.ts";
import { ingestParse, type ParseStepResult } from "./parse-step.ts";
import { ingestCompanyFacts, type FactsStepResult } from "./facts-step.ts";
import { ingestRatios, type RatiosStepResult } from "./ratios-step.ts";
import { ingestRedFlags, type RedFlagsStepResult } from "./red-flags-step.ts";
import type { IngestStore } from "./store.ts";
import { ingestSubmissions, type SubmissionsStepResult } from "./submissions-step.ts";

export interface IngestDeps {
  sec: SecClient;
  store: IngestStore;
  /** Voyage client for step 7; null or missing → the step is skipped with a warning. */
  voyage?: VoyageClient | null;
  /** Current time as ISO text; injectable for tests. */
  now?: () => string;
}

export interface IngestResult {
  runId: number;
  submissions: SubmissionsStepResult;
  facts: FactsStepResult;
  ratios: RatiosStepResult;
  redFlags: RedFlagsStepResult;
  documents: DocumentsStepResult;
  parse: ParseStepResult;
  embed: EmbedStepResult;
}

export async function runIngest(args: IngestArgs, deps: IngestDeps): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const { sec, store } = deps;
  const runId = await store.startRun(args.ticker, { from: args.fromYear, to: args.toYear });
  const counts: Record<string, number> = {};

  try {
    const submissions = await ingestSubmissions(sec, store, args);
    counts.filings = submissions.tenKs.length;
    counts.older_pages = submissions.olderPagesFetched;
    await store.updateRun(runId, { company_id: submissions.companyId, step: "submissions", counts });

    const facts = await ingestCompanyFacts(sec, store, submissions.companyId, submissions.cik);
    counts.facts = facts.stored;
    counts.facts_reported = facts.stats.annualReported;
    counts.facts_restated = facts.stats.restated;
    counts.sec_requests = sec.requestCount;
    await store.updateRun(runId, { step: "company_facts", counts });

    const ratios = await ingestRatios(store, submissions.companyId, submissions.sectorProfile, facts.facts, now);
    counts.ratios = ratios.stored;
    counts.ratios_ok = ratios.ok;
    counts.ratios_not_applicable = ratios.notApplicable;
    await store.updateRun(runId, { step: "ratios", counts });

    const redFlags = await ingestRedFlags(store, submissions.companyId, ratios.profileUsed, facts.facts, ratios.results);
    counts.red_flags = redFlags.stored;
    await store.updateRun(runId, { step: "red_flags", counts });

    const documents = await ingestDocuments(
      sec,
      store,
      submissions.companyId,
      args.ticker,
      submissions.cik,
      submissions.tenKs,
    );
    counts.documents_downloaded = documents.downloaded;
    counts.documents_already_saved = documents.alreadySaved;
    counts.documents_repaired = documents.repaired;
    counts.sec_requests = sec.requestCount;
    await store.updateRun(runId, { step: "documents", counts });

    const parse = await ingestParse(store, submissions.companyId, submissions.tenKs, { reparse: args.reparse ?? false });
    counts.filings_parsed = parse.parsed;
    counts.filings_already_parsed = parse.skipped;
    counts.sections = parse.sections;
    counts.chunks = parse.chunks;
    await store.updateRun(runId, { step: "parse", counts });

    const windowYears: number[] = [];
    for (let y = args.fromYear; y <= args.toYear; y++) windowYears.push(y);
    const embed = await ingestEmbeddings(store, deps.voyage ?? null, submissions.companyId, windowYears);
    counts.passages_embedded = embed.embedded;
    counts.filings_embedded = embed.filingsEmbedded;
    counts.voyage_requests = embed.requests;
    counts.voyage_tokens = embed.tokens;
    const warnings = [...submissions.warnings, ...parse.warnings, ...embed.warnings];
    await store.updateRun(runId, {
      step: "embed",
      counts,
      status: "success",
      finished_at: now(),
      ...(warnings.length > 0 ? { error: `Warnings: ${warnings.join("; ")}` } : {}),
    });
    return { runId, submissions, facts, ratios, redFlags, documents, parse, embed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    counts.sec_requests = sec.requestCount;
    // Record the failure, but don't let a logging problem hide the real error.
    await store.updateRun(runId, { status: "failed", error: message, counts, finished_at: now() }).catch(() => undefined);
    throw error;
  }
}
