/**
 * Number check (CLAUDE.md: "Numbers come from XBRL, never from the AI").
 * Pure functions: pull the figures out of an answer, then check each one:
 *   1. xbrl:       exactly one stored financial fact has that value, within
 *                  the rounding the answer used ("$157 million" = 156.5–157.5M)
 *   2. passage:    otherwise, the figure appears in the passages Claude was
 *                  given (segment growth, basis points, counts...)
 *   3. unverified: neither, so it may have been calculated or made up
 * Rules learned on real answers (decisions 2026-11-24), because any round
 * number matches some fact by coincidence:
 *  - Dollar amounts only, with at least 3 significant digits ("$1.3 billion"
 *    is never compared; with 2 it matched an unrelated tax asset). Percentages and basis points are checked against the
 *    text only: companies define their own ratios, and a "3%" matched a 2.5%
 *    tax-rate line within rounding.
 *  - A year in the same sentence narrows the facts to that fiscal year or the
 *    one before (Walmart calls the year ending January 2026 "fiscal 2026";
 *    our label is 2025).
 *  - The match must be unique. Several facts of that size → not counted as
 *    XBRL; the figure falls back to the text check and `xbrlCandidates`
 *    records how many facts it could have been.
 */

export type FigureKind = "usd" | "percent" | "bps";

export interface Figure {
  /** As written in the answer, e.g. "$8.5 billion". */
  raw: string;
  kind: FigureKind;
  /** Absolute value in dollars (usd), percent points (percent) or basis points. */
  value: number;
  /** Half a unit of the last digit written, in the same units: "$8.5 billion" → 50,000,000. */
  tolerance: number;
  /** True when no scale word was written ("$2.41"), so it may be a per-share amount. */
  unscaled: boolean;
  /** The number's digits as written ("8.5", "1,890"), for finding it in passages. */
  digits: string;
  /** Position in the answer text. */
  index: number;
}

/** The subset of a financial_facts row the check needs. */
export interface CheckFact {
  concept: string;
  unit: string;
  value: number;
  fiscalYear: number;
}

export type FigureStatus = "xbrl" | "passage" | "unverified";

export interface FigureCheck {
  figure: Figure;
  status: FigureStatus;
  /** For xbrl: the one matching fact. */
  match?: CheckFact;
  /** When several facts had that value (so none was chosen): how many. */
  xbrlCandidates?: number;
}

/** Significant digits as written: "113" → 3, "1.0" → 2, "29,348" → 5, "0.05" → 1. */
export function significantDigits(digits: string): number {
  const plain = digits.replace(/,/g, "");
  const [int = "", dec = ""] = plain.split(".");
  const all = (int + dec).replace(/^0+/, "");
  if (dec === "") return all.replace(/0+$/, "").length || 1; // "1000" written as a whole number: trailing zeros don't count
  return all.length;
}

/** Four-digit years (1990–2099) in the sentence around position `index`. */
export function yearsNear(text: string, index: number): number[] {
  const before = text.lastIndexOf(". ", index);
  const afterDot = text.indexOf(". ", index);
  const start = before === -1 ? 0 : before + 2;
  const end = afterDot === -1 ? text.length : afterDot;
  const sentence = text.slice(start, end);
  return [...sentence.matchAll(/\b(19[9]\d|20\d{2})\b/g)].map((m) => Number(m[1]));
}

/** With 2 digits, "$1.3 billion" uniquely matched an unrelated deferred tax asset in testing. */
const MIN_SIGNIFICANT_DIGITS = 3;

export interface NumberCheck {
  figures: FigureCheck[];
  total: number;
  xbrl: number;
  passage: number;
  unverified: number;
}

const SCALES: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  mm: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
};

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?`;
const SCALE = String.raw`(?:\s?(thousand|million|billion|trillion|bn|mm|[mbk])\b)`;
// "$157 million", "−$1.2 billion", "$2.41"
const MONEY = new RegExp(String.raw`\$\s?${NUM}${SCALE}?`, "gi");
// "157 million" without a dollar sign (only with a scale word, so years and counts are skipped)
const SCALED = new RegExp(String.raw`(?<![\d.$])${NUM}\s(million|billion|trillion)\b`, "gi");
// "24.2%", "24.2 %", "2 percent"
const PERCENT = new RegExp(String.raw`(?<![\d.])${NUM}\s?(?:%|percent\b)`, "gi");
// "40 basis points", "40 bps"
const BPS = new RegExp(String.raw`(?<![\d.])${NUM}\s?(?:basis points?|bps)\b`, "gi");

function toNumber(intPart: string, decPart: string | undefined): number {
  return Number(`${intPart.replace(/,/g, "")}${decPart ? `.${decPart}` : ""}`);
}

function halfUnit(decPart: string | undefined): number {
  return 0.5 * 10 ** -(decPart?.length ?? 0);
}

/** Every money, percentage and basis-point figure in the text, in order. */
export function extractFigures(text: string): Figure[] {
  const figures: Figure[] = [];
  const taken: [number, number][] = [];
  const free = (start: number, end: number) => taken.every(([s, e]) => end <= s || start >= e);
  const add = (f: Figure, end: number) => {
    taken.push([f.index, end]);
    figures.push(f);
  };

  for (const m of text.matchAll(MONEY)) {
    const [raw, int, dec, scaleWord] = m;
    const scale = scaleWord ? (SCALES[scaleWord.toLowerCase()] ?? 1) : 1;
    add(
      {
        raw,
        kind: "usd",
        value: toNumber(int!, dec) * scale,
        tolerance: halfUnit(dec) * scale,
        unscaled: !scaleWord,
        digits: dec ? `${int}.${dec}` : int!,
        index: m.index,
      },
      m.index + raw.length,
    );
  }
  for (const m of text.matchAll(SCALED)) {
    const [raw, int, dec, scaleWord] = m;
    if (!free(m.index, m.index + raw.length)) continue;
    const scale = SCALES[scaleWord!.toLowerCase()]!;
    add(
      {
        raw,
        kind: "usd",
        value: toNumber(int!, dec) * scale,
        tolerance: halfUnit(dec) * scale,
        unscaled: false,
        digits: dec ? `${int}.${dec}` : int!,
        index: m.index,
      },
      m.index + raw.length,
    );
  }
  for (const [pattern, kind] of [
    [PERCENT, "percent"],
    [BPS, "bps"],
  ] as const) {
    for (const m of text.matchAll(pattern)) {
      const [raw, int, dec] = m;
      if (!free(m.index, m.index + raw.length)) continue;
      add(
        {
          raw,
          kind,
          value: toNumber(int!, dec),
          tolerance: halfUnit(dec),
          unscaled: true,
          digits: dec ? `${int}.${dec}` : int!,
          index: m.index,
        },
        m.index + raw.length,
      );
    }
  }
  return figures.sort((a, b) => a.index - b.index);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if the figure's digits appear as a whole number in any passage ("157" in "LIFO charge 157 95"). */
export function appearsInPassages(figure: Figure, passages: readonly string[]): boolean {
  // Commas optional both ways: "1,890" matches "1890" and vice versa.
  const plain = figure.digits.replace(/,/g, "");
  const [int, dec] = plain.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",?");
  const body = `${grouped}${dec ? escapeRegExp(`.${dec}`) : ""}`;
  const pattern = new RegExp(`(?<![\\d.,])${body}(?![\\d]|[.,]\\d)`);
  return passages.some((p) => pattern.test(p));
}

/** Dollar facts within the figure's rounding (per-share facts too when no scale word was written). */
function candidates(figure: Figure, facts: readonly CheckFact[]): CheckFact[] {
  // Only dollar amounts precise enough to identify a fact; never $0.
  if (figure.kind !== "usd" || figure.value === 0 || significantDigits(figure.digits) < MIN_SIGNIFICANT_DIGITS) return [];
  return facts.filter((fact) => {
    if (fact.unit !== "USD" && !(figure.unscaled && fact.unit === "USD/shares")) return false;
    const distance = Math.abs(Math.abs(fact.value) - figure.value);
    // A tiny epsilon absorbs floating-point noise at the rounding boundary.
    return distance <= figure.tolerance + 1e-9 * Math.max(1, figure.value);
  });
}

/** Keeps facts from a fiscal year named in the sentence (or the year before); all of them if none fit. */
function narrowByYear(matches: CheckFact[], years: readonly number[]): CheckFact[] {
  if (years.length === 0) return matches;
  const allowed = new Set(years.flatMap((y) => [y, y - 1]));
  const narrowed = matches.filter((f) => allowed.has(f.fiscalYear));
  return narrowed.length > 0 ? narrowed : matches;
}

export function checkFigures(text: string, facts: readonly CheckFact[], passages: readonly string[]): NumberCheck {
  const figures = extractFigures(text).map((figure): FigureCheck => {
    const matches = narrowByYear(candidates(figure, facts), yearsNear(text, figure.index));
    const concepts = new Set(matches.map((f) => f.concept));
    if (concepts.size === 1) {
      // One line item (possibly in more than one year): take the latest year.
      const match = matches.reduce((a, b) => (b.fiscalYear > a.fiscalYear ? b : a));
      return { figure, status: "xbrl", match };
    }
    const status = appearsInPassages(figure, passages) ? "passage" : "unverified";
    return concepts.size > 1 ? { figure, status, xbrlCandidates: concepts.size } : { figure, status };
  });
  return {
    figures,
    total: figures.length,
    xbrl: figures.filter((f) => f.status === "xbrl").length,
    passage: figures.filter((f) => f.status === "passage").length,
    unverified: figures.filter((f) => f.status === "unverified").length,
  };
}
