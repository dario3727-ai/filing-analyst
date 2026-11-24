/**
 * Runs a profile's red-flag rules for every fiscal year. Pure.
 * Rules read inputs (resolved from facts, like metrics) and computed metric
 * values (from the ratio engine's results). If anything a rule needs is
 * missing or not applicable, the rule doesn't fire: a missing number never
 * produces a warning, and never a guess.
 */
import type { RatioResult } from "./engine.ts";
import { resolveInput, type Fact, type ResolvedValue } from "./resolve.ts";
import { ruleKey, type InputDef, type RedFlagRule, type SectorProfile } from "./types.ts";

export interface RedFlagResult {
  fiscalYear: number;
  rule: string;
  detail: string;
  evidence: Record<string, number>;
  /** Notes from the metrics used (53-week years, tag caveats, crash-test label). */
  notes: string[];
}

export function evaluateRedFlags(
  facts: readonly Fact[],
  profile: SectorProfile,
  ratios: readonly RatioResult[],
): RedFlagResult[] {
  const inputs = new Map<string, InputDef>(profile.inputs.map((i) => [i.id, i]));
  const ratioByKey = new Map(ratios.map((r) => [`${r.metric}|${r.fiscalYear}`, r]));
  const cache = new Map<string, ResolvedValue | undefined>();
  const resolve = (input: InputDef, year: number) => {
    const k = `${input.id}|${year}`;
    if (!cache.has(k)) cache.set(k, resolveInput(facts, input, year));
    return cache.get(k);
  };

  const years = [...new Set(ratios.map((r) => r.fiscalYear))].sort((a, b) => a - b);
  const flags: RedFlagResult[] = [];
  for (const year of years) {
    for (const rule of profile.redFlags) {
      const flag = run(rule, year);
      if (flag) flags.push(flag);
    }
  }
  return flags;

  function run(rule: RedFlagRule, year: number): RedFlagResult | undefined {
    const values: Record<string, number> = {};
    const notes: string[] = [];
    for (const ref of rule.requires) {
      const y = ref.year === "prior" ? year - 1 : year;
      if ("input" in ref) {
        const input = inputs.get(ref.input);
        const r = input && resolve(input, y);
        if (!r) return undefined;
        values[ruleKey(ref)] = r.value;
      } else {
        const r = ratioByKey.get(`${ref.metric}|${y}`);
        if (!r || r.status !== "ok" || r.value === null) return undefined;
        values[ruleKey(ref)] = r.value;
        for (const note of r.inputs.notes) if (!notes.includes(note)) notes.push(note);
      }
    }
    const outcome = rule.check(values);
    if (!outcome.fired) return undefined;
    return { fiscalYear: year, rule: rule.id, detail: outcome.detail, evidence: outcome.evidence, notes };
  }
}
