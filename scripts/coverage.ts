// npm run coverage
// Parser coverage report: for every stored filing, which of Items 1, 1A, 7,
// 7A and 8 were found, plus the share of parsed filings with all five.
// Reads with the publishable (read-only) key.
import { createClient } from "@supabase/supabase-js";
import { summarizeCoverage, type FilingCoverageInput } from "../src/lib/filings/coverage.ts";
import { TARGET_ITEMS } from "../src/lib/filings/sections.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase URL or publishable key missing (run npm run check:env)");
const db = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await db
  .from("filings")
  .select("fiscal_year, status, storage_path, companies(ticker), sections(item, word_count)")
  .limit(1000);
if (error) throw new Error(error.message);

const inputs: FilingCoverageInput[] = (data ?? []).map((row) => {
  const company = row.companies as unknown as { ticker?: unknown } | null;
  const sections = (row.sections ?? []) as unknown as { item: unknown }[];
  return {
    ticker: String(company?.ticker ?? "?"),
    fiscalYear: Number(row.fiscal_year),
    status: String(row.status),
    downloaded: row.storage_path !== null,
    items: sections.map((s) => String(s.item)),
  };
});

const summary = summarizeCoverage(inputs);
const mark = (has: boolean) => (has ? "✓" : "✗");
console.log(`ticker  FY    ${TARGET_ITEMS.map((i) => i.padEnd(3)).join(" ")}  status`);
for (const f of summary.filings) {
  const cells = TARGET_ITEMS.map((i) => (f.state === "complete" || f.state === "partial" ? mark(f.items.includes(i)) : "·").padEnd(3));
  const note =
    f.state === "partial" ? `missing ${f.missing.join(", ")}` : f.state === "complete" ? "complete" : f.state.replace("_", " ");
  console.log(`${f.ticker.padEnd(6)}  ${f.fiscalYear}  ${cells.join(" ")}  ${note}`);
}
const share = summary.share === null ? "n/a" : `${(summary.share * 100).toFixed(1)}%`;
console.log(`\nAll five sections found in ${summary.complete} of ${summary.parsed} parsed filings: ${share}`);
const notParsed = summary.filings.length - summary.parsed;
if (notParsed > 0) console.log(`${notParsed} filing(s) not yet downloaded or parsed (outside the loaded window), not counted.`);
const missingItems = Object.entries(summary.missingByItem).filter(([, n]) => n > 0);
if (missingItems.length > 0) console.log(`Missing most often: ${missingItems.map(([i, n]) => `Item ${i} (${n})`).join(", ")}`);
