// npm run profile:coverage [-- --from 2019 --to 2025]
// For each loaded company, which tag supplies each retail-profile input, and
// which years have nothing. Reads with the publishable (read-only) key.
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { retailProfile } from "../src/metrics/profiles/retail.ts";
import { resolveInput, type Fact } from "../src/metrics/resolve.ts";

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } });
const fromYear = Number(values.from ?? 2019);
const toYear = Number(values.to ?? 2025);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase URL or publishable key missing (run npm run check:env)");
const db = createClient(url, key, { auth: { persistSession: false } });

const tags = [...new Set(retailProfile.inputs.flatMap((i) => i.tags.map((t) => t.tag)))];
const { data: companies, error } = await db.from("companies").select("id, ticker").order("ticker");
if (error) throw new Error(error.message);

const short = (tag: string) => tag.replace("us-gaap:", "").replace(/(.{28}).+/, "$1…");
const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
console.log(`Retail profile input coverage, fiscal ${fromYear}–${toYear} (${years.length} years)\n`);

for (const company of companies ?? []) {
  const { data, error: factsError } = await db
    .from("financial_facts")
    .select("concept, unit, period_start, period_end, fiscal_year, value")
    .eq("company_id", company.id)
    .in("concept", tags)
    .gte("fiscal_year", fromYear)
    .lte("fiscal_year", toYear)
    .limit(5000);
  if (factsError) throw new Error(factsError.message);
  const facts: Fact[] = (data ?? []).map((r) => ({
    concept: String(r.concept),
    unit: String(r.unit),
    periodStart: r.period_start === null ? null : String(r.period_start),
    periodEnd: String(r.period_end),
    fiscalYear: Number(r.fiscal_year),
    value: Number(r.value),
  }));

  console.log(`${company.ticker}`);
  for (const input of retailProfile.inputs) {
    const resolved = years.map((y) => ({ y, r: resolveInput(facts, input, y) }));
    const used = [...new Set(resolved.flatMap(({ r }) => (r ? [short(r.tag)] : [])))];
    const missing = resolved.filter(({ r }) => !r).map(({ y }) => y);
    const noted = resolved.some(({ r }) => r?.note !== undefined) ? "  (note)" : "";
    const gaps = missing.length === 0 ? "" : missing.length === years.length ? "  NONE" : `  missing ${missing.join(", ")}`;
    console.log(`  ${input.id.padEnd(20)} ${used.join(" + ") || "-"}${noted}${gaps}`);
  }
}
