/**
 * One ingest run for one company, logged in ingestion_runs from start to
 * finish, including failures. `step` records the last step completed, so a
 * failed run shows how far it got. Later tasks add ratios and red flags.
 */
import type { SecClient } from "../sec/client.ts";
import type { IngestArgs } from "./args.ts";
import { ingestCompanyFacts, type FactsStepResult } from "./facts-step.ts";
import type { IngestStore } from "./store.ts";
import { ingestSubmissions, type SubmissionsStepResult } from "./submissions-step.ts";

export interface IngestDeps {
  sec: SecClient;
  store: IngestStore;
  /** Current time as ISO text; injectable for tests. */
  now?: () => string;
}

export interface IngestResult {
  runId: number;
  submissions: SubmissionsStepResult;
  facts: FactsStepResult;
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
    await store.updateRun(runId, {
      step: "company_facts",
      counts,
      status: "success",
      finished_at: now(),
      ...(submissions.warnings.length > 0 ? { error: `Warnings: ${submissions.warnings.join("; ")}` } : {}),
    });
    return { runId, submissions, facts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    counts.sec_requests = sec.requestCount;
    // Record the failure, but don't let a logging problem hide the real error.
    await store.updateRun(runId, { status: "failed", error: message, counts, finished_at: now() }).catch(() => undefined);
    throw error;
  }
}
