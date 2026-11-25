// npm run ask -- --ticker WMT --q "Why did gross margin change?" [--from 2023 --to 2025] [--model sonnet]
// Search + one Claude call, printed with numbered citations. Haiku by default
// (development); --model sonnet uses the Q&A model. One Voyage + one Claude request.
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { answerQuestion, DEV_MODEL, QA_MODEL } from "../src/lib/qa/answer.ts";
import { loadFactsForCheck } from "../src/lib/qa/load-facts.ts";
import { checkFigures } from "../src/lib/qa/numbers.ts";
import { saveAnswer, toAnswerRow } from "../src/lib/qa/store-answer.ts";
import { searchPassages } from "../src/lib/search/hybrid.ts";
import { createVoyageClientFromEnv } from "../src/lib/voyage/client.ts";

const { values } = parseArgs({
  options: {
    ticker: { type: "string" },
    q: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    model: { type: "string" },
  },
});
const usage = 'Usage: npm run ask -- --ticker WMT --q "question" [--from 2023 --to 2025] [--model sonnet]';
if (!values.ticker || !values.q) throw new Error(usage);
const model = values.model === "sonnet" ? QA_MODEL : DEV_MODEL;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase URL or publishable key missing (run npm run check:env)");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (run npm run check:env)");
const voyage = createVoyageClientFromEnv(process.env, { maxRequests: 3 });
if (!voyage) throw new Error("VOYAGE_API_KEY is not set (run npm run check:env)");
const db = createClient(url, key, { auth: { persistSession: false } });
// The answers table is private: saving needs the secret key (scripts and server code only).
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is not set (run npm run check:env)");
const adminDb = createClient(url, secretKey, { auth: { persistSession: false } });
const anthropic = new Anthropic();

const { data: company, error } = await db
  .from("companies")
  .select("id, name, ticker")
  .eq("ticker", values.ticker.toUpperCase())
  .maybeSingle();
if (error) throw new Error(error.message);
if (!company) throw new Error(`${values.ticker} is not loaded`);

const fromYear = Number(values.from ?? 2023);
const toYear = Number(values.to ?? 2025);
const passages = await searchPassages(
  values.q,
  { companyId: Number(company.id), fromYear, toYear, limit: 8 },
  { voyage, rpc: async (name, args) => db.rpc(name, args) },
);
const started = performance.now();
const answer = await answerQuestion(
  values.q,
  passages,
  { companyName: String(company.name), ticker: String(company.ticker), fromYear, toYear, model },
  { createMessage: (params) => anthropic.beta.messages.create(params) },
);
const latencyMs = performance.now() - started;

// Number sources in the order they're first cited.
const numberOf = new Map(answer.citedPassageIds.map((id, i) => [id, i + 1]));
const body = answer.segments
  .map((s) => s.text + (s.citations.length ? ` [${[...new Set(s.citations.map((c) => numberOf.get(c.passageId)))].join(",")}]` : ""))
  .join("");
console.log(`Q: ${values.q}  (${company.name}, fiscal ${fromYear}–${toYear}, ${answer.model})\n`);
console.log(`Status: ${answer.status}\n`);
console.log(body.trim() || "(no text)");
if (answer.citedPassageIds.length > 0) console.log("\nSources:");
for (const id of answer.citedPassageIds) {
  const p = passages.find((x) => x.id === id)!;
  console.log(`  [${numberOf.get(id)}] FY${p.fiscalYear} Item ${p.item}${p.heading ? ` · ${p.heading}` : ""}, p. ${p.pageStart}  (passage ${id})`);
}
const facts = await loadFactsForCheck(db, Number(company.id), fromYear, toYear);
const check = checkFigures(answer.text, facts, passages.map((p) => p.content));
if (check.total > 0) {
  console.log(
    `\nNumbers: ${check.total} found · ${check.xbrl} match XBRL · ${check.passage} quoted from the filing text · ${check.unverified} unverified`,
  );
  for (const f of check.figures) {
    const detail =
      f.status === "xbrl"
        ? `XBRL ${f.match!.concept} FY${f.match!.fiscalYear} = ${f.match!.value}`
        : (f.status === "passage" ? "in the passages" : "NOT FOUND in XBRL or passages") +
          (f.xbrlCandidates ? ` (value shared by ${f.xbrlCandidates} XBRL items, so not counted)` : "");
    console.log(`  ${f.figure.raw.padEnd(18)} ${detail}`);
  }
}
const answerId = await saveAnswer(
  adminDb,
  toAnswerRow({ companyId: Number(company.id), fromYear, toYear, question: values.q, answer, passages, check, latencyMs }),
);
console.log(
  `\n${passages.length} passages sent · ${answer.inputTokens} input + ${answer.outputTokens} output tokens · ` +
    `${(latencyMs / 1000).toFixed(1)} s · saved as answer #${answerId}`,
);
