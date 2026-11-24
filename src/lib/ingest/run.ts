/**
 * One ingest run for one company, logged in ingestion_runs from start to
 * finish, including failures. Later tasks add more steps (company facts,
 * ratios, red flags) after submissions.
 */
import type { SecClient } from "../sec/client.ts";
import type { IngestArgs } from "./args.ts";
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
}

export async function runIngest(args: IngestArgs, deps: IngestDeps): Promise<IngestResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const runId = await deps.store.startRun(args.ticker, { from: args.fromYear, to: args.toYear });

  try {
    const submissions = await ingestSubmissions(deps.sec, deps.store, args);
    await deps.store.updateRun(runId, {
      company_id: submissions.companyId,
      step: "submissions",
      counts: {
        filings: submissions.tenKs.length,
        older_pages: submissions.olderPagesFetched,
        sec_requests: deps.sec.requestCount,
      },
      status: "success",
      finished_at: now(),
      ...(submissions.warnings.length > 0 ? { error: `Warnings: ${submissions.warnings.join("; ")}` } : {}),
    });
    return { runId, submissions };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Record the failure, but don't let a logging problem hide the real error.
    await deps.store
      .updateRun(runId, { status: "failed", error: message, finished_at: now() })
      .catch(() => undefined);
    throw error;
  }
}
