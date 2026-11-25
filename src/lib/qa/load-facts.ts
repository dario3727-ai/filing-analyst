/**
 * Loads the XBRL facts the number check compares against (and the XBRL
 * passages are built from): the company's
 * facts for the searched fiscal years plus the two before, because each 10-K
 * also reports the two prior years. Paged (the API returns at most 1,000 rows
 * per request) with a hard cap.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fact } from "../../metrics/resolve.ts";

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
/** Each 10-K reports three years of results. */
export const PRIOR_YEARS_REPORTED = 2;

export async function loadFactsForCheck(
  db: SupabaseClient,
  companyId: number,
  fromYear: number,
  toYear: number,
): Promise<Fact[]> {
  const facts: Fact[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const { data, error } = await db
      .from("financial_facts")
      .select("concept, unit, value, fiscal_year, period_start, period_end")
      .eq("company_id", companyId)
      .gte("fiscal_year", fromYear - PRIOR_YEARS_REPORTED)
      .lte("fiscal_year", toYear)
      .order("id")
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(`Reading facts failed: ${error.message}`);
    const rows = (data ?? []) as { concept: string; unit: string; value: number | string; fiscal_year: number; period_start: string | null; period_end: string }[];
    for (const r of rows) {
      facts.push({ concept: r.concept, unit: r.unit, value: Number(r.value), fiscalYear: r.fiscal_year, periodStart: r.period_start, periodEnd: r.period_end });
    }
    if (rows.length < PAGE_SIZE) return facts;
  }
  throw new Error(`More than ${MAX_PAGES * PAGE_SIZE} facts to check against; raise the cap deliberately.`);
}
