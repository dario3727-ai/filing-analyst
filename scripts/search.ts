// npm run search -- --ticker WMT --q "Why did gross margin change?" [--from 2023 --to 2025] [--item 7] [--limit 8]
// Tries hybrid search from the terminal: embeds the question (1 Voyage request)
// and calls search_chunks with the publishable (read-only) key.
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { searchPassages } from "../src/lib/search/hybrid.ts";
import { createVoyageClientFromEnv } from "../src/lib/voyage/client.ts";

const { values } = parseArgs({
  options: {
    ticker: { type: "string" },
    q: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    item: { type: "string", multiple: true },
    limit: { type: "string" },
  },
});
const usage = 'Usage: npm run search -- --ticker WMT --q "question" [--from 2023 --to 2025] [--item 7] [--limit 8]';
if (!values.ticker || !values.q) throw new Error(usage);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase URL or publishable key missing (run npm run check:env)");
const voyage = createVoyageClientFromEnv(process.env, { maxRequests: 3 });
if (!voyage) throw new Error("VOYAGE_API_KEY is not set (run npm run check:env)");
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: company, error } = await db.from("companies").select("id, name").eq("ticker", values.ticker.toUpperCase()).maybeSingle();
if (error) throw new Error(error.message);
if (!company) throw new Error(`${values.ticker} is not loaded`);

const fromYear = Number(values.from ?? 2023);
const toYear = Number(values.to ?? 2025);
const passages = await searchPassages(
  values.q,
  { companyId: Number(company.id), fromYear, toYear, limit: Number(values.limit ?? 8), ...(values.item ? { items: values.item } : {}) },
  { voyage, rpc: async (name, args) => db.rpc(name, args) },
);

console.log(`"${values.q}": ${company.name}, fiscal ${fromYear}–${toYear}\n`);
console.log("score   meaning keyword  where");
for (const p of passages) {
  const rank = (r: number | null) => (r === null ? "  -" : String(r).padStart(3));
  console.log(
    `${p.score.toFixed(4)}  ${rank(p.semanticRank)}     ${rank(p.keywordRank)}     FY${p.fiscalYear} Item ${p.item} p.${p.pageStart}${p.heading ? `  ${p.heading}` : ""}`,
  );
  console.log(`        ${p.content.slice(0, 150).replace(/\s+/g, " ")}…`);
}
console.log(`\n${passages.length} passages, ${voyage.tokenCount} Voyage tokens.`);
