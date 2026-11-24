// Development aid: show what the section parser extracts from each fixture.
// npm run inspect:sections [-- --ticker WMT]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { parseFiling } from "../src/lib/filings/sections.ts";

const { values } = parseArgs({ options: { ticker: { type: "string" } } });
const tickers = values.ticker ? [values.ticker.toLowerCase()] : ["wmt", "tgt", "cost", "kr", "gap", "five", "adbe"];

for (const t of tickers) {
  const bytes = gunzipSync(readFileSync(new URL(`../tests/fixtures/filings/${t}-2025.htm.gz`, import.meta.url)));
  const started = performance.now();
  const r = parseFiling(new Uint8Array(bytes));
  const ms = Math.round(performance.now() - started);
  console.log(`\n${t.toUpperCase()}  ${r.totalPages} pages, ${r.totalBlocks} blocks, parsed in ${ms} ms${r.missing.length ? `  MISSING ${r.missing.join(",")}` : ""}`);
  for (const w of r.warnings) console.log(`  warning: ${w}`);
  for (const s of r.sections) {
    const opening = s.blocks.slice(0, 2).map((b) => b.text).join(" | ").slice(0, 110);
    console.log(
      `  ${s.item.padEnd(3)} p${String(s.pageStart).padStart(3)}–${String(s.pageEnd).padEnd(3)} ${String(s.wordCount).padStart(6)} words  "${s.title.slice(0, 45)}"\n        ${opening}`,
    );
  }
}
