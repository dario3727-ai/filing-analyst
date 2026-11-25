// npm run eval:cases
// Builds the Q&A eval set (decisions 2026-11-25) and writes it for review:
//   eval/qa/cases.json  (what the runner reads)
//   eval/qa/cases.md    (what a person reviews)
// Four groups: the 10 milestone-3 questions; numeric questions generated from
// XBRL (expected answer = the reported figure); questions a 10-K can't
// answer; explanation questions. Deterministic: same database, same cases.
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { MILESTONE3_QUESTIONS } from "../src/config/milestone3-questions.ts";
import { retailProfile } from "../src/metrics/profiles/retail.ts";
import { resolveInput, type Fact } from "../src/metrics/resolve.ts";

export interface EvalCase {
  id: string;
  group: "handwritten" | "numeric" | "unanswerable" | "explanation";
  ticker: string;
  question: string;
  fromYear: number;
  toYear: number;
  expect: "answered" | "not_answered";
  /** Numeric cases: the reported figure the answer must state. */
  expected?: { value: number; unit: string; concept: string; periodEnd: string };
  lookFor: string;
}

const NAMES: Record<string, string> = { WMT: "Walmart", TGT: "Target", COST: "Costco", KR: "Kroger", GAP: "Gap Inc.", FIVE: "Five Below" };
const PHRASE: Record<string, string> = {
  revenue: "total revenue",
  net_income: "net income",
  operating_income: "operating income",
  eps_diluted: "diluted earnings per share",
  operating_cash_flow: "cash provided by operating activities",
  capex: "capital expenditures",
  dividends: "total dividends paid",
  buybacks: "spending on share repurchases",
  inventory: "merchandise inventory",
  long_term_debt: "long-term debt",
};

// Five per retailer, spread over inputs and years. Kroger has no inventory tag, Five Below pays no dividends.
const PLAN: [string, string, number][] = [
  ["WMT", "revenue", 2025], ["WMT", "operating_income", 2024], ["WMT", "eps_diluted", 2023], ["WMT", "capex", 2025], ["WMT", "inventory", 2024],
  ["TGT", "revenue", 2024], ["TGT", "net_income", 2025], ["TGT", "eps_diluted", 2024], ["TGT", "buybacks", 2024], ["TGT", "dividends", 2025],
  ["COST", "revenue", 2023], ["COST", "net_income", 2024], ["COST", "operating_cash_flow", 2025], ["COST", "capex", 2024], ["COST", "eps_diluted", 2025],
  ["KR", "revenue", 2025], ["KR", "operating_income", 2023], ["KR", "net_income", 2024], ["KR", "eps_diluted", 2025], ["KR", "long_term_debt", 2025],
  ["GAP", "revenue", 2025], ["GAP", "net_income", 2023], ["GAP", "operating_income", 2024], ["GAP", "inventory", 2025], ["GAP", "eps_diluted", 2024],
  ["FIVE", "revenue", 2024], ["FIVE", "net_income", 2025], ["FIVE", "operating_income", 2023], ["FIVE", "capex", 2025], ["FIVE", "inventory", 2024],
];

const UNANSWERABLE: Omit<EvalCase, "group" | "expect">[] = [
  { id: "na-wmt-grocery-share", ticker: "WMT", question: "What is Walmart's market share of U.S. grocery sales?", fromYear: 2025, toYear: 2025, lookFor: "Says the filing doesn't state a market share; no invented percentage." },
  { id: "na-tgt-analyst-eps", ticker: "TGT", question: "What earnings per share did analysts expect Target to report for fiscal 2025?", fromYear: 2025, toYear: 2025, lookFor: "Analyst estimates aren't in a 10-K; may give the reported EPS only as context." },
  { id: "na-tgt-ceo-salary", ticker: "TGT", question: "What was the base salary of Target's CEO?", fromYear: 2025, toYear: 2025, lookFor: "Executive pay is in the proxy statement, not the 10-K." },
  { id: "na-cost-member-age", ticker: "COST", question: "What is the average age of a Costco member?", fromYear: 2025, toYear: 2025, lookFor: "Not disclosed; no invented age." },
  { id: "na-kr-texas-share", ticker: "KR", question: "What is Kroger's market share in Texas?", fromYear: 2025, toYear: 2025, lookFor: "Not disclosed by state; no invented figure." },
  { id: "na-gap-2026-comps", ticker: "GAP", question: "What comparable sales growth does Gap Inc. forecast for fiscal 2026?", fromYear: 2025, toYear: 2025, lookFor: "No comparable sales forecast in the 10-K." },
  { id: "na-gap-athleta-units", ticker: "GAP", question: "How many pairs of Athleta leggings were sold in fiscal 2025?", fromYear: 2025, toYear: 2025, lookFor: "Unit sales by product aren't disclosed." },
  { id: "na-five-2026-income", ticker: "FIVE", question: "What net income will Five Below earn in fiscal 2026?", fromYear: 2025, toYear: 2025, lookFor: "No earnings forecast in the 10-K (store-opening plans don't answer it)." },
  { id: "na-five-price-target", ticker: "FIVE", question: "What is the analyst consensus price target for Five Below's stock?", fromYear: 2025, toYear: 2025, lookFor: "Price targets aren't in a 10-K." },
  { id: "na-wmt-store-manager-pay", ticker: "WMT", question: "How much does a Walmart store manager earn on average?", fromYear: 2025, toYear: 2025, lookFor: "Not disclosed as an average figure; no invented number." },
];

const EXPLANATION: Omit<EvalCase, "group" | "expect">[] = [
  { id: "ex-cost-gross-margin", ticker: "COST", question: "Why did Costco's gross margin percentage change?", fromYear: 2025, toYear: 2025, lookFor: "The basis-point change and the drivers MD&A names, cited." },
  { id: "ex-tgt-comps", ticker: "TGT", question: "Why did Target's comparable sales change in fiscal 2025?", fromYear: 2025, toYear: 2025, lookFor: "Direction of comps and the reasons MD&A gives (traffic, ticket, categories), cited." },
  { id: "ex-gap-athleta", ticker: "GAP", question: "Why did Athleta's sales decline?", fromYear: 2025, toYear: 2025, lookFor: "The reasons the filing gives for Athleta's decline, or says it doesn't explain them." },
  { id: "ex-kr-albertsons", ticker: "KR", question: "What happened with Kroger's proposed merger with Albertsons?", fromYear: 2024, toYear: 2025, lookFor: "Termination and the litigation or costs the filings describe, cited." },
  { id: "ex-wmt-automation", ticker: "WMT", question: "How is Walmart using automation in its supply chain?", fromYear: 2025, toYear: 2025, lookFor: "Automation investments the filing describes, cited; no outside knowledge." },
  { id: "ex-five-sourcing", ticker: "FIVE", question: "What risks does Five Below describe related to sourcing merchandise from China?", fromYear: 2025, toYear: 2025, lookFor: "Import dependence, tariffs and supplier risks from Item 1A, cited." },
  { id: "ex-cost-ecommerce", ticker: "COST", question: "How did Costco's e-commerce business perform?", fromYear: 2025, toYear: 2025, lookFor: "E-commerce growth as the filing states it, cited." },
  { id: "ex-wmt-inventory", ticker: "WMT", question: "Why did Walmart's inventory change between the last two fiscal years?", fromYear: 2024, toYear: 2025, lookFor: "The inventory change and the reasons the liquidity discussion gives, cited." },
];

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function formatExpected(value: number, unit: string): string {
  if (unit === "USD/shares") return `$${value.toFixed(2)}`;
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  return abs >= 1e9 ? `${sign}$${(abs / 1e9).toFixed(2)} billion (${value.toLocaleString("en-US")})` : `${sign}$${(abs / 1e6).toFixed(1)} million (${value.toLocaleString("en-US")})`;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase URL or publishable key missing");
const db = createClient(url, key, { auth: { persistSession: false } });

async function factsFor(ticker: string): Promise<Fact[]> {
  const { data: company } = await db.from("companies").select("id").eq("ticker", ticker).single();
  const facts: Fact[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db
      .from("financial_facts")
      .select("concept, unit, value, period_start, period_end, fiscal_year")
      .eq("company_id", (company as { id: number }).id)
      .gte("fiscal_year", 2023)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { concept: string; unit: string; value: number; period_start: string | null; period_end: string; fiscal_year: number }[];
    facts.push(...rows.map((r) => ({ concept: r.concept, unit: r.unit, value: Number(r.value), periodStart: r.period_start, periodEnd: r.period_end, fiscalYear: r.fiscal_year })));
    if (rows.length < 1000) break;
  }
  return facts;
}

const cases: EvalCase[] = MILESTONE3_QUESTIONS.map((q) => ({
  id: `m3-${q.id}`,
  group: "handwritten" as const,
  ticker: q.ticker,
  question: q.question,
  fromYear: q.fromYear,
  toYear: q.toYear,
  expect: q.expect,
  lookFor: q.lookFor,
}));

const factCache = new Map<string, Fact[]>();
for (const [ticker, inputId, year] of PLAN) {
  if (!factCache.has(ticker)) factCache.set(ticker, await factsFor(ticker));
  const input = retailProfile.inputs.find((i) => i.id === inputId)!;
  const found = resolveInput(factCache.get(ticker)!, input, year);
  if (!found) throw new Error(`No ${inputId} for ${ticker} FY${year}: fix the plan`);
  const when = input.kind === "instant" ? `at the end of the fiscal year ended ${longDate(found.periodEnd)}` : `for the fiscal year ended ${longDate(found.periodEnd)}`;
  cases.push({
    id: `num-${ticker.toLowerCase()}-${inputId.replace(/_/g, "-")}-${year}`,
    group: "numeric",
    ticker,
    question: `What was ${NAMES[ticker]}'s ${PHRASE[inputId]} ${when}?`,
    fromYear: year,
    toYear: year,
    expect: "answered",
    expected: { value: found.value, unit: input.unit, concept: found.tag, periodEnd: found.periodEnd },
    lookFor: `States ${formatExpected(found.value, input.unit)} (XBRL ${found.tag}), supported by a cited passage.`,
  });
}
for (const c of UNANSWERABLE) cases.push({ ...c, group: "unanswerable", expect: "not_answered" });
for (const c of EXPLANATION) cases.push({ ...c, group: "explanation", expect: "answered" });

mkdirSync("eval/qa", { recursive: true });
writeFileSync("eval/qa/cases.json", JSON.stringify(cases, null, 2) + "\n");

const fence = "````";
const md = [
  "# Q&A eval cases",
  "",
  `${cases.length} cases, generated by \`npm run eval:cases\`. Groups: ${["handwritten", "numeric", "unanswerable", "explanation"].map((g) => `${cases.filter((c) => c.group === g).length} ${g}`).join(", ")}.`,
  "",
  "| id | group | company | years | expected | look for |",
  "| --- | --- | --- | --- | --- | --- |",
  ...cases.map((c) => `| ${c.id} | ${c.group} | ${c.ticker} | ${c.fromYear === c.toYear ? c.fromYear : `${c.fromYear}–${c.toYear}`} | ${c.expect} | ${c.lookFor.replace(/\|/g, "\\|")} |`),
  "",
  ...cases.flatMap((c) => [`## ${c.id}`, "", fence, c.question, fence, ""]),
].join("\n");
writeFileSync("eval/qa/cases.md", md);
console.log(`Wrote ${cases.length} cases to eval/qa/cases.json and eval/qa/cases.md`);
