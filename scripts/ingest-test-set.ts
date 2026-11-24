// npm run ingest:test-set [-- --from 2023 --to 2025]
// Loads all seven test-set companies, one after another, sharing one
// rate-limited SEC client. A failure is logged and the rest still run;
// the script exits with code 1 if any company failed.
import { parseArgs } from "node:util";
import { DEV_WINDOW, TEST_SET } from "../src/config/test-set.ts";
import { parseIngestArgs } from "../src/lib/ingest/args.ts";
import { runIngest } from "../src/lib/ingest/run.ts";
import { createSupabaseStoreFromEnv } from "../src/lib/ingest/supabase-store.ts";
import { createSecClientFromEnv } from "../src/lib/sec/client.ts";

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } });
const from = values.from ?? String(DEV_WINDOW.fromYear);
const to = values.to ?? String(DEV_WINDOW.toYear);

// Hard cap for the whole set: about 3 requests per company plus older pages and retries.
const sec = createSecClientFromEnv(process.env, { maxRequests: 100 });
const store = createSupabaseStoreFromEnv(process.env);

console.log(`Loading ${TEST_SET.length} companies, fiscal years ${from}–${to}\n`);
const rows: string[] = [];
let failures = 0;

for (const company of TEST_SET) {
  try {
    const args = parseIngestArgs(["--ticker", company.ticker, "--from", from, "--to", to], new Date().getFullYear());
    const r = await runIngest(args, { sec, store });
    const warn = r.submissions.warnings.length > 0 ? `  warning: ${r.submissions.warnings.join("; ")}` : "";
    rows.push(
      `${company.ticker.padEnd(5)} ok    10-Ks ${String(r.submissions.tenKs.length).padStart(2)}  facts ${String(r.facts.stored).padStart(5)}  ` +
        `ratios ${String(r.ratios.ok).padStart(3)} computed / ${String(r.ratios.notApplicable).padStart(3)} n/a  ` +
        `flags ${String(r.redFlags.stored).padStart(2)}  docs ${r.documents.downloaded} new / ${r.documents.alreadySaved + r.documents.repaired} saved  ` +
        `run #${r.runId}${r.ratios.crashTest ? "  (crash test)" : ""}${warn}`,
    );
  } catch (error) {
    failures++;
    rows.push(`${company.ticker.padEnd(5)} FAIL  ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const row of rows) console.log(row);
console.log(`\n${TEST_SET.length - failures}/${TEST_SET.length} loaded, ${sec.requestCount} SEC requests.`);
if (failures > 0) process.exitCode = 1;
