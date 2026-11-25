/**
 * Pairs last year's risks with this year's (decisions 2026-11-25). Pure.
 *  1. Same title (ignoring case, punctuation and spacing) → same risk.
 *  2. Otherwise, best word overlap of title and opening text, greedily,
 *     above a threshold: catches a reworded title for the same risk.
 *  3. Left over: removed (old only) or added (new only).
 * A matched pair is "unchanged" when its full text is identical (spacing
 * aside), "modified" otherwise.
 */
import type { Risk } from "./split.ts";

export type RiskChangeKind = "added" | "removed" | "modified" | "unchanged";

export interface RiskPair {
  kind: RiskChangeKind;
  old: Risk | null;
  new: Risk | null;
  /** 1 for identical titles; the overlap score for fuzzy matches; null for added/removed. */
  similarity: number | null;
}

/** Fuzzy matches need at least this overlap score. */
export const MATCH_THRESHOLD = 0.45;
const OPENING_WORDS = 60;

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeTitle(text).split(" ").filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** How alike two risks are: the better of title overlap alone and title + opening-text overlap. */
export function similarity(a: Risk, b: Risk): number {
  const opening = (r: Risk) => r.body.split(/\s+/).slice(0, OPENING_WORDS).join(" ");
  const titleScore = jaccard(wordSet(a.title), wordSet(b.title));
  const bodyScore = jaccard(wordSet(opening(a)), wordSet(opening(b)));
  return Math.max(titleScore, (titleScore + bodyScore) / 2);
}

const fullText = (r: Risk) => `${r.title}\n${r.body}`.replace(/\s+/g, " ").trim();

export function matchRisks(oldRisks: readonly Risk[], newRisks: readonly Risk[]): RiskPair[] {
  const pairs: RiskPair[] = [];
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const pair = (o: Risk, n: Risk, score: number) => {
    usedOld.add(o.index);
    usedNew.add(n.index);
    pairs.push({ kind: fullText(o) === fullText(n) ? "unchanged" : "modified", old: o, new: n, similarity: score });
  };

  // 1. Identical titles.
  const oldByTitle = new Map<string, Risk[]>();
  for (const o of oldRisks) {
    const key = normalizeTitle(o.title);
    oldByTitle.set(key, [...(oldByTitle.get(key) ?? []), o]);
  }
  for (const n of newRisks) {
    const o = oldByTitle.get(normalizeTitle(n.title))?.find((c) => !usedOld.has(c.index));
    if (o) pair(o, n, 1);
  }

  // 2. Best remaining overlaps, highest first.
  const candidates: { o: Risk; n: Risk; score: number }[] = [];
  for (const o of oldRisks) {
    if (usedOld.has(o.index)) continue;
    for (const n of newRisks) {
      if (usedNew.has(n.index)) continue;
      const score = similarity(o, n);
      if (score >= MATCH_THRESHOLD) candidates.push({ o, n, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) if (!usedOld.has(c.o.index) && !usedNew.has(c.n.index)) pair(c.o, c.n, c.score);

  // 3. Leftovers.
  for (const o of oldRisks) if (!usedOld.has(o.index)) pairs.push({ kind: "removed", old: o, new: null, similarity: null });
  for (const n of newRisks) if (!usedNew.has(n.index)) pairs.push({ kind: "added", old: null, new: n, similarity: null });

  // In this year's order, removed risks at their old position.
  const position = (p: RiskPair) => (p.new ? p.new.index : (p.old?.index ?? 0) - 0.5);
  return pairs.sort((a, b) => position(a) - position(b));
}
