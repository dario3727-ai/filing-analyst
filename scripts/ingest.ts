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
  const { runId, submissions: s, facts: f, ratios: r } = await runIngest(args, { sec, store });

  console.log(`  company: ${s.name} (CIK ${s.cik}), profile: ${s.sectorProfile}`);
  for (const t of s.tenKs) {
    console.log(`  10-K  FY${t.fiscalYear}  period ending ${t.periodEnd}  filed ${t.filedAt}  ${t.primaryDocument}`);
  }
  if (s.olderPagesFetched > 0) console.log(`  older filing pages fetched: ${s.olderPagesFetched}`);
  console.log(
    `  facts: ${f.stored} stored (FY${f.firstYear ?? "?"}–FY${f.lastYear ?? "?"}), from ${f.stats.annualReported} annual ` +
      `reports; ${f.stats.reportedMoreThanOnce} periods reported more than once, ${f.stats.restated} restated`,
  );
  for (const r of f.sampleRestatements) {
    console.log(
      `    restated: ${r.concept} ending ${r.periodEnd}: ${r.original.value} (filed ${r.original.filed}) → ${r.latest.value} (filed ${r.latest.filed})`,
    );
  }
  console.log(
    `  ratios: ${r.stored} stored with the ${r.profile} profile${r.crashTest ? " (crash test: not a retailer)" : ""}; ` +
      `${r.ok} computed, ${r.notApplicable} not applicable`,
  );
  const topReasons = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).slice(0, 4);
  for (const [reason, count] of topReasons) console.log(`    ${count} × ${reason}`);
  for (const w of s.warnings) console.log(`  warning: ${w}`);
  console.log(`Done. Run #${runId}, ${sec.requestCount} SEC requests.`);
} catch (error) {
  console.error(`Ingest failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
