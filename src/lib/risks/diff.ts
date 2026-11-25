/**
 * Word-level diff between two versions of a risk (decisions 2026-11-25).
 * Pure. Classic longest-common-subsequence over words: everything not in
 * the common part was deleted (old) or inserted (new). This is what finds
 * "could require" → "has required" exactly; no AI is involved.
 */

export type DiffOp = { op: "equal" | "delete" | "insert"; text: string };

/** Above this many word pairs, the risk is treated as fully rewritten (keeps memory bounded). */
export const MAX_DIFF_CELLS = 6_000_000;

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Word diff of `a` (old) → `b` (new), with consecutive same-type words merged into one op. */
export function diffWords(a: string, b: string): DiffOp[] {
  const x = tokenize(a);
  const y = tokenize(b);
  const ops: DiffOp[] = [];
  const add = (op: DiffOp["op"], word: string) => {
    const last = ops.at(-1);
    if (last && last.op === op) last.text += ` ${word}`;
    else ops.push({ op, text: word });
  };

  // Common start and end are cheap to strip and shrink the table a lot.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  for (let i = 0; i < start; i++) add("equal", x[i]!);

  const n = endX - start;
  const m = endY - start;
  if (n * m > MAX_DIFF_CELLS) {
    for (let i = start; i < endX; i++) add("delete", x[i]!);
    for (let j = start; j < endY; j++) add("insert", y[j]!);
  } else {
    // lcs[i][j] = length of the LCS of x[start+i..endX) and y[start+j..endY), stored flat.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          x[start + i] === y[start + j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[start + i] === y[start + j]) {
        add("equal", x[start + i]!);
        i++;
        j++;
      } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
        add("delete", x[start + i]!);
        i++;
      } else {
        add("insert", y[start + j]!);
        j++;
      }
    }
    for (; i < n; i++) add("delete", x[start + i]!);
    for (; j < m; j++) add("insert", y[start + j]!);
  }
  for (let i = endX; i < x.length; i++) add("equal", x[i]!);
  return ops;
}

export interface DiffStats {
  wordsAdded: number;
  wordsRemoved: number;
  wordsKept: number;
}

export function diffStats(ops: readonly DiffOp[]): DiffStats {
  const count = (op: DiffOp["op"]) => ops.filter((o) => o.op === op).reduce((n, o) => n + tokenize(o.text).length, 0);
  return { wordsAdded: count("insert"), wordsRemoved: count("delete"), wordsKept: count("equal") };
}

export interface Edit {
  before: string;
  after: string;
}

/** Each place the text changed: what it said, what it says now ("could require" → "has required"). */
export function edits(ops: readonly DiffOp[]): Edit[] {
  const out: Edit[] = [];
  let current: Edit | null = null;
  for (const o of ops) {
    if (o.op === "equal") {
      if (current) out.push(current);
      current = null;
    } else {
      current ??= { before: "", after: "" };
      if (o.op === "delete") current.before = current.before ? `${current.before} ${o.text}` : o.text;
      else current.after = current.after ? `${current.after} ${o.text}` : o.text;
    }
  }
  if (current) out.push(current);
  return out;
}

/** True when every change only swaps numbers (years, page or note references): "fiscal 2024" → "fiscal 2025". */
export function onlyNumbersChanged(ops: readonly DiffOp[]): boolean {
  const changed = edits(ops);
  const numeric = (s: string) => tokenize(s).every((w) => /^[($]*[\d.,%]+[)]*[.,;:]?$/.test(w));
  return changed.length > 0 && changed.every((e) => numeric(e.before) && numeric(e.after));
}
