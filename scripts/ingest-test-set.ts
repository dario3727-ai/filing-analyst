// npm run ingest:test-set [-- --from 2023 --to 2025 --reparse]
// Loads all seven test-set companies, one after another, sharing one
// rate-limited SEC client. A failure is logged and the rest still run;
// the script exits with code 1 if any company failed.
import { parseArgs } from "node:util";
import { DEV_WINDOW, TEST_SET } from "../src/config/test-set.ts";
import { parseIngestArgs } from "../src/lib/ingest/args.ts";
import { runIngest } from "../src/lib/ingest/run.ts";
import { createSupabaseStoreFromEnv } from "../src/lib/ingest/supabase-store.ts";
import { createSecClientFromEnv } from "../src/lib/sec/client.ts";
import { createVoyageClientFromEnv } from "../src/lib/voyage/client.ts";

const { values } = parseArgs({
  options: { from: { type: "string" }, to: { type: "string" }, reparse: { type: "boolean", default: false } },
});
const from = values.from ?? String(DEV_WINDOW.fromYear);
const to = values.to ?? String(DEV_WINDOW.toYear);

// Hard cap for the whole set: about 3 data requests per company, one per new
// 10-K document, plus older pages and retries.
const sec = createSecClientFromEnv(process.env, { maxRequests: 150 });
const store = createSupabaseStoreFromEnv(process.env);
// Hard cap for the whole set: ~4,900 passages ≈ 45 requests at ≤128 per request, plus retries.
const voyage = createVoyageClientFromEnv(process.env, { maxRequests: 150 });

console.log(`Loading ${TEST_SET.length} companies, fiscal years ${from}–${to}${values.reparse ? " (re-parsing text)" : ""}\n`);
const rows: string[] = [];
let failures = 0;

for (const company of TEST_SET) {
  try {
    const argv = ["--ticker", company.ticker, "--from", from, "--to", to, ...(values.reparse ? ["--reparse"] : [])];
    const r = await runIngest(parseIngestArgs(argv, new Date().getFullYear()), { sec, store, voyage });
    const warnings = [...r.submissions.warnings, ...r.parse.warnings, ...r.embed.warnings];
    rows.push(
      `${company.ticker.padEnd(5)} ok    10-Ks ${String(r.submissions.tenKs.length).padStart(2)}  facts ${String(r.facts.stored).padStart(5)}  ` +
        `ratios ${String(r.ratios.ok).padStart(3)}/${String(r.ratios.notApplicable).padStart(3)} n/a  ` +
        `flags ${String(r.redFlags.stored).padStart(2)}  docs ${r.documents.downloaded} new  ` +
        `parsed ${r.parse.parsed} (${String(r.parse.chunks).padStart(4)} passages), ${r.parse.skipped} skipped  ` +
        `embedded ${String(r.embed.embedded).padStart(4)}  ` +
        `run #${r.runId}${r.ratios.crashTest ? "  (crash test)" : ""}${warnings.length ? `  warning: ${warnings.join("; ")}` : ""}`,
    );
  } catch (error) {
    failures++;
    rows.push(`${company.ticker.padEnd(5)} FAIL  ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const row of rows) console.log(row);
console.log(`\n${TEST_SET.length - failures}/${TEST_SET.length} loaded, ${sec.requestCount} SEC requests.`);
if (failures > 0) process.exitCode = 1;
