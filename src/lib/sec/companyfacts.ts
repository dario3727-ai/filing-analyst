/**
 * SEC company facts (every XBRL-tagged number a company has reported) →
 * one checked, de-duplicated list of annual facts.
 *
 * The SEC's JSON looks like:
 *   { facts: { "us-gaap": { "Revenues": { units: { "USD": [
 *       { start: "2025-02-01", end: "2026-01-31", val: 1, accn: "...", fy: 2026,
 *         fp: "FY", form: "10-K", filed: "2026-03-13" }, ... ] } } } } }
 *
 * What we keep (see docs/decisions.md):
 *  - facts reported in a 10-K or 10-K/A;
 *  - durations of about a year (350–380 days, covering 52/53-week years);
 *  - point-in-time values (no start date, e.g. inventory on the balance
 *    sheet) only when dated at one of the company's fiscal year ends;
 *  - one value per (concept, unit, period): the most recently filed one, so
 *    restatements win. Every 10-K repeats prior years, so most periods are
 *    reported 2–3 times.
 */
import { fiscalYearLabel, parseIsoDate } from "../fiscal-year.ts";

export interface RawFact {
  concept: string; // "us-gaap:Revenues"
  unit: string;
  start: string | null;
  end: string;
  value: number;
  accession: string;
  form: string;
  filed: string;
}

export interface AnnualFact {
  concept: string;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
  fiscalYear: number;
  value: number;
  accession: string;
  filed: string;
  form: string;
}

export interface Restatement {
  concept: string;
  unit: string;
  periodStart: string | null;
  periodEnd: string;
  original: { value: number; filed: string };
  latest: { value: number; filed: string };
}

export interface FactStats {
  /** Facts in the SEC response (all forms, all periods). */
  raw: number;
  /** Malformed entries skipped. */
  skipped: number;
  /** Annual 10-K facts before de-duplication. */
  annualReported: number;
  /** After de-duplication: one per concept, unit and period. */
  unique: number;
  /** Periods reported by more than one filing. */
  reportedMoreThanOnce: number;
  /** Periods where a later filing reported a different value. */
  restated: number;
}

export const ANNUAL_FORMS: readonly string[] = ["10-K", "10-K/A"];
const MIN_ANNUAL_DAYS = 350;
const MAX_ANNUAL_DAYS = 380;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flattens the nested JSON into one RawFact per entry, skipping malformed entries. */
export function parseCompanyFacts(data: unknown): { facts: RawFact[]; skipped: number } {
  if (!isRecord(data) || !isRecord(data.facts)) {
    throw new Error('SEC company facts: expected an object with a "facts" object');
  }
  const facts: RawFact[] = [];
  let skipped = 0;

  for (const [taxonomy, concepts] of Object.entries(data.facts)) {
    if (!isRecord(concepts)) continue;
    for (const [name, concept] of Object.entries(concepts)) {
      if (!isRecord(concept) || !isRecord(concept.units)) continue;
      for (const [unit, entries] of Object.entries(concept.units)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!isRecord(entry)) {
            skipped++;
            continue;
          }
          const { start, end, val, accn, form, filed } = entry;
          const ok =
            typeof end === "string" && DATE.test(end) &&
            (start === undefined || (typeof start === "string" && DATE.test(start))) &&
            typeof val === "number" && Number.isFinite(val) &&
            typeof accn === "string" && typeof form === "string" &&
            typeof filed === "string" && DATE.test(filed);
          if (!ok) {
            skipped++;
            continue;
          }
          facts.push({
            concept: `${taxonomy}:${name}`,
            unit,
            start: (start as string | undefined) ?? null,
            end: end as string,
            value: val as number,
            accession: accn as string,
            form: form as string,
            filed: filed as string,
          });
        }
      }
    }
  }
  return { facts, skipped };
}

function durationDays(start: string, end: string): number {
  return (parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / DAY_MS + 1;
}

const key = (f: { concept: string; unit: string; start: string | null; end: string }) =>
  `${f.concept}|${f.unit}|${f.start ?? ""}|${f.end}`;

/** Later filing wins; same day → higher accession number, so the choice is stable. */
function isNewer(a: RawFact, b: RawFact): boolean {
  return a.filed !== b.filed ? a.filed > b.filed : a.accession > b.accession;
}

export function selectAnnualFacts(
  raw: readonly RawFact[],
  skipped = 0,
): { facts: AnnualFact[]; restatements: Restatement[]; stats: FactStats } {
  // 1. Annual-form facts with a ~1-year duration; these also tell us the fiscal year ends.
  const fromAnnualForms = raw.filter((f) => ANNUAL_FORMS.includes(f.form));
  const durations = fromAnnualForms.filter((f) => {
    if (f.start === null) return false;
    const days = durationDays(f.start, f.end);
    return days >= MIN_ANNUAL_DAYS && days <= MAX_ANNUAL_DAYS;
  });
  const fiscalYearEnds = new Set(durations.map((f) => f.end));

  // 2. Point-in-time values dated at a fiscal year end.
  const instants = fromAnnualForms.filter((f) => f.start === null && fiscalYearEnds.has(f.end));
  const annual = [...durations, ...instants];

  // 3. Group by period; keep the newest filing and note earlier differing values.
  const groups = new Map<string, { newest: RawFact; oldest: RawFact; filings: Set<string> }>();
  for (const f of annual) {
    const k = key(f);
    const g = groups.get(k);
    if (!g) {
      groups.set(k, { newest: f, oldest: f, filings: new Set([f.accession]) });
      continue;
    }
    g.filings.add(f.accession);
    if (isNewer(f, g.newest)) g.newest = f;
    if (isNewer(g.oldest, f)) g.oldest = f;
  }

  const facts: AnnualFact[] = [];
  const restatements: Restatement[] = [];
  let reportedMoreThanOnce = 0;
  for (const { newest, oldest, filings } of groups.values()) {
    if (filings.size > 1) reportedMoreThanOnce++;
    if (oldest.value !== newest.value) {
      restatements.push({
        concept: newest.concept,
        unit: newest.unit,
        periodStart: newest.start,
        periodEnd: newest.end,
        original: { value: oldest.value, filed: oldest.filed },
        latest: { value: newest.value, filed: newest.filed },
      });
    }
    facts.push({
      concept: newest.concept,
      unit: newest.unit,
      periodStart: newest.start,
      periodEnd: newest.end,
      fiscalYear: fiscalYearLabel(newest.end, newest.start ?? undefined),
      value: newest.value,
      accession: newest.accession,
      filed: newest.filed,
      form: newest.form,
    });
  }

  facts.sort((a, b) => a.concept.localeCompare(b.concept) || a.periodEnd.localeCompare(b.periodEnd));
  return {
    facts,
    restatements,
    stats: {
      raw: raw.length + skipped,
      skipped,
      annualReported: annual.length,
      unique: facts.length,
      reportedMoreThanOnce,
      restated: restatements.length,
    },
  };
}
