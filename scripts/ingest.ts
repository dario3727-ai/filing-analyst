// npm run ingest -- --ticker WMT --from 2023 --to 2025
// Loads one company into Supabase and logs the run in ingestion_runs.
import { parseIngestArgs } from "../src/lib/ingest/args.ts";
import { runIngest } from "../src/lib/ingest/run.ts";
import { createSupabaseStoreFromEnv } from "../src/lib/ingest/supabase-store.ts";
import { createSecClientFromEnv } from "../src/lib/sec/client.ts";

try {
  const args = parseIngestArgs(process.argv.slice(2), new Date().getFullYear());
  const sec = createSecClientFromEnv(process.env, { maxRequests: 50 });
  const store = createSupabaseStoreFromEnv(process.env);

  console.log(`Ingesting ${args.ticker}, fiscal years ${args.fromYear}–${args.toYear}...`);
  const { runId, submissions: s } = await runIngest(args, { sec, store });

  console.log(`  company: ${s.name} (CIK ${s.cik}), profile: ${s.sectorProfile}`);
  for (const t of s.tenKs) {
    console.log(`  10-K  FY${t.fiscalYear}  period ending ${t.periodEnd}  filed ${t.filedAt}  ${t.primaryDocument}`);
  }
  if (s.olderPagesFetched > 0) console.log(`  older filing pages fetched: ${s.olderPagesFetched}`);
  for (const w of s.warnings) console.log(`  warning: ${w}`);
  console.log(`Done. Run #${runId}, ${sec.requestCount} SEC requests.`);
} catch (error) {
  console.error(`Ingest failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
