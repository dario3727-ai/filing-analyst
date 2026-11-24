// Development aid: passage statistics for each fixture, plus a sample.
// npm run inspect:chunks [-- --ticker WMT --sample 1A]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { chunkSection } from "../src/lib/filings/chunks.ts";
import { parseFiling } from "../src/lib/filings/sections.ts";

const { values } = parseArgs({ options: { ticker: { type: "string" }, sample: { type: "string" } } });
const tickers = values.ticker ? [values.ticker.toLowerCase()] : ["wmt", "tgt", "cost", "kr", "gap", "five", "adbe"];
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
let grand = 0;

for (const t of tickers) {
  const bytes = gunzipSync(readFileSync(new URL(`../tests/fixtures/filings/${t}-2025.htm.gz`, import.meta.url)));
  const parsed = parseFiling(new Uint8Array(bytes));
  const rows: string[] = [];
  let filingTotal = 0;
  for (const s of parsed.sections) {
    const chunks = chunkSection(s);
    filingTotal += chunks.length;
    const tokens = chunks.map((c) => c.tokenCount).sort((a, b) => a - b);
    const tables = chunks.filter((c) => c.kind === "table").length;
    const headed = chunks.filter((c) => c.heading !== null).length;
    rows.push(
      `  ${s.item.padEnd(3)} ${String(chunks.length).padStart(3)} passages  tokens min ${pct(tokens, 0)} / median ${pct(tokens, 0.5)} / max ${pct(tokens, 1)}  tables ${tables}  with heading ${headed}`,
    );
    if (values.sample === s.item) {
      for (const c of chunks.slice(1, 3)) {
        console.log(`\n--- ${t.toUpperCase()} Item ${s.item} #${c.chunkIndex} (${c.kind}, p${c.pageStart}–${c.pageEnd}, ~${c.tokenCount} tokens, heading: ${c.heading ?? "none"})\n${c.text}`);
      }
    }
  }
  grand += filingTotal;
  console.log(`\n${t.toUpperCase()}: ${filingTotal} passages`);
  for (const r of rows) console.log(r);
}
console.log(`\nTotal: ${grand} passages for ${tickers.length} filing(s)`);
