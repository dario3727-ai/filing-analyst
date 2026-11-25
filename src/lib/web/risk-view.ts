/**
 * Arranges risk_changes rows for the What changed screen. Pure.
 * Per year pair: new risks, then removed, then reworded, most material
 * first (then most words changed); unchanged risks only counted.
 */
import { edits, type DiffOp, type Edit } from "../risks/diff.ts";

export interface RiskChangeRecord {
  from_year: number;
  to_year: number;
  position: number;
  kind: "added" | "removed" | "modified" | "unchanged";
  category: string | null;
  old_title: string | null;
  new_title: string | null;
  old_text: string | null;
  new_text: string | null;
  diff: DiffOp[];
  words_added: number;
  words_removed: number;
  numbers_only: boolean;
  summary: string | null;
  materiality: "high" | "medium" | "low" | null;
}

export interface RiskItem {
  kind: "added" | "removed" | "modified";
  title: string;
  /** Set when a reworded risk's title changed too. */
  oldTitle: string | null;
  category: string | null;
  summary: string | null;
  materiality: "high" | "medium" | "low" | null;
  wordsAdded: number;
  wordsRemoved: number;
  numbersOnly: boolean;
  /** Reworded: each edit, old → new. */
  edits: Edit[];
  /** Added or removed: the risk's full text. */
  text: string | null;
}

export interface RiskPairView {
  fromYear: number;
  toYear: number;
  items: RiskItem[];
  unchanged: number;
  counts: { added: number; removed: number; modified: number; high: number };
}

const KIND_ORDER = { added: 0, removed: 1, modified: 2 } as const;
const MATERIALITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function buildRiskView(rows: readonly RiskChangeRecord[]): RiskPairView[] {
  const pairs = new Map<string, RiskChangeRecord[]>();
  for (const r of rows) {
    const key = `${r.from_year}-${r.to_year}`;
    pairs.set(key, [...(pairs.get(key) ?? []), r]);
  }
  return [...pairs.values()]
    .map((list) => {
      const changed = list.filter((r): r is RiskChangeRecord & { kind: RiskItem["kind"] } => r.kind !== "unchanged");
      const items = changed
        .map(
          (r): RiskItem => ({
            kind: r.kind,
            title: (r.new_title ?? r.old_title)!,
            oldTitle: r.kind === "modified" && r.old_title !== r.new_title ? r.old_title : null,
            category: r.category,
            summary: r.summary,
            materiality: r.materiality,
            wordsAdded: r.words_added,
            wordsRemoved: r.words_removed,
            numbersOnly: r.numbers_only,
            edits: r.kind === "modified" ? edits(r.diff) : [],
            text: r.kind === "added" ? r.new_text : r.kind === "removed" ? r.old_text : null,
          }),
        )
        .sort(
          (a, b) =>
            KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
            MATERIALITY_ORDER[a.materiality ?? "low"] - MATERIALITY_ORDER[b.materiality ?? "low"] ||
            b.wordsAdded + b.wordsRemoved - (a.wordsAdded + a.wordsRemoved),
        );
      const first = list[0]!;
      return {
        fromYear: first.from_year,
        toYear: first.to_year,
        items,
        unchanged: list.length - changed.length,
        counts: {
          added: items.filter((i) => i.kind === "added").length,
          removed: items.filter((i) => i.kind === "removed").length,
          modified: items.filter((i) => i.kind === "modified").length,
          high: items.filter((i) => i.materiality === "high").length,
        },
      };
    })
    .sort((a, b) => b.toYear - a.toYear);
}
