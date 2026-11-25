import { describe, expect, it } from "vitest";
import { buildRiskView, type RiskChangeRecord } from "./risk-view.ts";

const row = (o: Partial<RiskChangeRecord>): RiskChangeRecord => ({
  from_year: 2024,
  to_year: 2025,
  position: 0,
  kind: "modified",
  category: null,
  old_title: "T",
  new_title: "T",
  old_text: "old",
  new_text: "new",
  diff: [],
  words_added: 0,
  words_removed: 0,
  numbers_only: false,
  summary: null,
  materiality: null,
  ...o,
});

describe("buildRiskView", () => {
  const view = buildRiskView([
    row({ position: 0, kind: "unchanged" }),
    row({ position: 1, kind: "modified", new_title: "Tariffs", old_title: "Tariffs", materiality: "low", words_added: 50 }),
    row({ position: 2, kind: "modified", new_title: "Debt", old_title: "Debt", materiality: "high", words_added: 5,
      diff: [{ op: "equal", text: "Tariffs" }, { op: "delete", text: "could require" }, { op: "insert", text: "have required" }] }),
    row({ position: 3, kind: "added", old_title: null, new_title: "AI agents", old_text: null, new_text: "Shoppers use AI.", materiality: "high" }),
    row({ position: 4, kind: "removed", new_title: null, old_title: "COVID-19", old_text: "Stores closed.", new_text: null, materiality: "medium" }),
    row({ from_year: 2023, to_year: 2024, kind: "unchanged" }),
  ]);

  it("puts the latest pair first, then new, removed and reworded risks, most material first", () => {
    expect(view.map((p) => `${p.fromYear}-${p.toYear}`)).toEqual(["2024-2025", "2023-2024"]);
    expect(view[0]!.items.map((i) => [i.kind, i.title])).toEqual([
      ["added", "AI agents"],
      ["removed", "COVID-19"],
      ["modified", "Debt"],
      ["modified", "Tariffs"],
    ]);
  });

  it("counts changes and unchanged risks, and carries the text or edits to show", () => {
    expect(view[0]).toMatchObject({ unchanged: 1, counts: { added: 1, removed: 1, modified: 2, high: 2 } });
    expect(view[0]!.items[0]).toMatchObject({ text: "Shoppers use AI.", edits: [] });
    expect(view[0]!.items[2]!.edits).toEqual([{ before: "could require", after: "have required" }]);
    expect(view[1]).toMatchObject({ items: [], unchanged: 1 });
  });
});
