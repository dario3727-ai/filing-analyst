/**
 * Ingest step 3: facts + sector profile → ratios, for every fiscal year.
 * Companies without a profile of their own (e.g. the Adobe crash test) get
 * the retail profile with a label on every result (decision 2026-11-24).
 */
import { computeRatios } from "../../metrics/engine.ts";
import { getProfile } from "../../metrics/profiles/index.ts";
import { retailProfile } from "../../metrics/profiles/retail.ts";
import type { Fact } from "../../metrics/resolve.ts";
import type { IngestStore } from "./store.ts";

export const CRASH_TEST_LABEL = "Retail metrics applied to a non-retail company (crash test)";

export interface RatiosStepResult {
  profile: string;
  crashTest: boolean;
  stored: number;
  ok: number;
  notApplicable: number;
  /** Count of not-applicable results per reason, for the run summary. */
  reasons: Record<string, number>;
}

export async function ingestRatios(
  store: IngestStore,
  companyId: number,
  sectorProfile: string,
  facts: readonly Fact[],
  now: () => string,
): Promise<RatiosStepResult> {
  const own = getProfile(sectorProfile);
  const profile = own ?? retailProfile;
  const results = computeRatios(facts, profile, own ? {} : { appliedLabel: CRASH_TEST_LABEL });

  const computedAt = now();
  const stored = await store.upsertRatios(
    results.map((r) => ({
      company_id: companyId,
      fiscal_year: r.fiscalYear,
      metric: r.metric,
      status: r.status,
      value: r.value,
      reason: r.reason,
      inputs: r.inputs,
      profile: profile.id,
      computed_at: computedAt,
    })),
  );

  const reasons: Record<string, number> = {};
  for (const r of results) {
    if (r.reason !== null) {
      // Group "No inventory reported for FY2019" and "...FY2020" together.
      const general = r.reason.replace(/FY\d{4}/g, "FYxxxx");
      reasons[general] = (reasons[general] ?? 0) + 1;
    }
  }
  const ok = results.filter((r) => r.status === "ok").length;
  return {
    profile: profile.id,
    crashTest: own === undefined,
    stored,
    ok,
    notApplicable: results.length - ok,
    reasons,
  };
}
