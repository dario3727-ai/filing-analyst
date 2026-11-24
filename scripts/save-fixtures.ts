// npm run fixtures:save [-- --write]
// Copies each test-set company's latest stored 10-K from Supabase Storage
// (not the SEC: we already have them) into tests/fixtures/filings/ for the
// parser tests. Without --write it only reports sizes and encodings.
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { TEST_SET } from "../src/config/test-set.ts";
import { checkEnv } from "../src/lib/env.ts";

const { values } = parseArgs({ options: { write: { type: "boolean", default: false } } });
const OUT_DIR = new URL("../tests/fixtures/filings/", import.meta.url);

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
  const r = checkEnv(process.env).find((x) => x.name === name);
  if (r?.status !== "ok") throw new Error(`${name} ${r?.problem ?? "is not set"}`);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "", {
  auth: { persistSession: false },
});

if (values.write) mkdirSync(OUT_DIR, { recursive: true });
let rawTotal = 0;
let gzTotal = 0;

for (const company of TEST_SET) {
  // Latest downloaded 10-K for the company.
  const { data: rows, error } = await db
    .from("filings")
    .select("fiscal_year, storage_path, companies!inner(ticker)")
    .eq("companies.ticker", company.ticker)
    .not("storage_path", "is", null)
    .order("fiscal_year", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = rows?.[0];
  if (!row?.storage_path) {
    console.log(`${company.ticker.padEnd(5)} no stored 10-K yet (run npm run ingest first)`);
    continue;
  }

  const { data, error: dlError } = await db.storage.from("raw-filings").download(String(row.storage_path));
  if (dlError || !data) throw new Error(`${row.storage_path}: ${dlError?.message}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const gz = gzipSync(bytes, { level: 9 });
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4000));
  const charset = /charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "none declared";
  const nonAscii = bytes.reduce((n, b) => n + (b > 127 ? 1 : 0), 0);
  rawTotal += bytes.length;
  gzTotal += gz.length;

  const file = `${company.ticker.toLowerCase()}-${row.fiscal_year}.htm.gz`;
  console.log(
    `${company.ticker.padEnd(5)} FY${row.fiscal_year}  ${(bytes.length / 1e6).toFixed(2)} MB raw  ${(gz.length / 1e6).toFixed(2)} MB gzip  ` +
      `charset: ${charset}  non-ASCII bytes: ${nonAscii}${values.write ? `  → ${file}` : ""}`,
  );
  if (values.write) writeFileSync(new URL(file, OUT_DIR), gz);
}
console.log(`total: ${(rawTotal / 1e6).toFixed(1)} MB raw, ${(gzTotal / 1e6).toFixed(1)} MB gzip${values.write ? "" : "  (dry run: add --write to save)"}`);
