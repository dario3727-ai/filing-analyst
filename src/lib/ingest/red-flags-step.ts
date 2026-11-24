/**
 * Ingest step 4: run the profile's red-flag rules over the ratios and
 * replace the company's rows in red_flags.
 */
import type { RatioResult } from "../../metrics/engine.ts";
import { evaluateRedFlags, type RedFlagResult } from "../../metrics/red-flags.ts";
import type { Fact } from "../../metrics/resolve.ts";
import type { SectorProfile } from "../../metrics/types.ts";
import type { IngestStore } from "./store.ts";

export interface RedFlagsStepResult {
  stored: number;
  flags: RedFlagResult[];
}

export async function ingestRedFlags(
  store: IngestStore,
  companyId: number,
  profile: SectorProfile,
  facts: readonly Fact[],
  ratios: readonly RatioResult[],
): Promise<RedFlagsStepResult> {
  const flags = evaluateRedFlags(facts, profile, ratios);
  const stored = await store.replaceRedFlags(
    companyId,
    flags.map((f) => ({
      company_id: companyId,
      fiscal_year: f.fiscalYear,
      rule: f.rule,
      detail: f.detail,
      evidence: { values: f.evidence, notes: f.notes },
    })),
  );
  return { stored, flags };
}
