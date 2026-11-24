// Development aid: print every block that looks like an "Item N" heading in
// the saved fixtures, with page, block index and the words that follow it.
// npm run inspect:headings [-- --ticker WMT]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { decodeFiling, htmlToBlocks } from "../src/lib/filings/blocks.ts";

const { values } = parseArgs({ options: { ticker: { type: "string" } } });
const tickers = values.ticker ? [values.ticker.toLowerCase()] : ["wmt", "tgt", "cost", "kr", "gap", "five", "adbe"];
const ITEM = /^(?:part\s+[ivx]+[\s,.:–—-]*)?item\s*(\d{1,2}[a-c]?)\b/i;

for (const t of tickers) {
  const bytes = gunzipSync(readFileSync(new URL(`../tests/fixtures/filings/${t}-2025.htm.gz`, import.meta.url)));
  const blocks = htmlToBlocks(decodeFiling(new Uint8Array(bytes)));
  const words = blocks.map((b) => b.text.split(" ").length);
  const totalWords = words.reduce((a, b) => a + b, 0);
  const lastPage = blocks.at(-1)?.page ?? 0;
  console.log(`\n${t.toUpperCase()}: ${blocks.length} blocks, ${totalWords} words, ${lastPage} pages`);
  blocks.forEach((b, i) => {
    const m = ITEM.exec(b.text);
    if (!m || b.text.length > 250) return;
    // Words until the next Item-like block, to tell table-of-contents lines from real headings.
    let span = 0;
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j];
      if (next && ITEM.test(next.text) && next.text.length <= 250) break;
      span += words[j] ?? 0;
    }
    console.log(`  #${String(i).padStart(5)} p${String(b.page).padStart(3)}  span ${String(span).padStart(6)}  ${b.text.slice(0, 90)}`);
  });
}
