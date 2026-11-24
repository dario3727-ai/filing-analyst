import { describe, expect, it } from "vitest";
import { retailProfile } from "../../metrics/profiles/retail.ts";
import type { Fact } from "../../metrics/resolve.ts";
import {
  buildInputTable,
  buildRatioTable,
  describeRedFlags,
  Footnotes,
  profileTags,
  readNotes,
  type RatioRow,
} from "./report.ts";

// Synthetic values, not any company's real figures.
const revenue = (fiscalYear: number, value: number, concept = "us-gaap:Revenues"): Fact => ({
  concept,
  unit: "USD",
  periodStart: `${fiscalYear}-02-01`,
  periodEnd: `${fiscalYear + 1}-01-31`,
  fiscalYear,
  value,
});

describe("Footnotes", () => {
  it("numbers each distinct text once", () => {
    const notes = new Footnotes();
    expect(notes.add("a")).toBe(1);
    expect(notes.add("b")).toBe(2);
    expect(notes.add("a")).toBe(1);
    expect(notes.list()).toEqual([
      { n: 1, text: "a" },
      { n: 2, text: "b" },
    ]);
  });
});

describe("buildInputTable", () => {
  it("resolves each input per year and records the tags used", () => {
    const facts = [revenue(2024, 100), revenue(2025, 110, "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax")];
    const rows = buildInputTable(facts, retailProfile, [2023, 2024, 2025], new Footnotes());
    const rev = rows.find((r) => r.id === "revenue")!;
    expect(rev.cells.map((c) => c?.value)).toEqual([undefined, 100, 110]);
    expect(rev.tags).toEqual(["us-gaap:Revenues", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"]);
    expect(rows).toHaveLength(retailProfile.inputs.length);
  });
});

describe("readNotes", () => {
  it("reads string notes and ignores malformed jsonb", () => {
    expect(readNotes({ values: {}, notes: ["x", 3, "y"] })).toEqual(["x", "y"]);
    expect(readNotes(null)).toEqual([]);
    expect(readNotes({ notes: "x" })).toEqual([]);
  });
});

describe("buildRatioTable", () => {
  const rows: RatioRow[] = [
    { fiscal_year: 2025, metric: "gross_margin", status: "ok", value: 0.245, reason: null, inputs: { notes: ["53-week year"] } },
    { fiscal_year: 2024, metric: "gross_margin", status: "not_applicable", value: null, reason: "Cost of sales not reported", inputs: {} },
    { fiscal_year: 2025, metric: "old_metric", status: "ok", value: 1.5, reason: null, inputs: {} },
  ];
  it("formats values, turns reasons and notes into footnotes, and marks missing years", () => {
    const notes = new Footnotes();
    const table = buildRatioTable(rows, retailProfile, [2023, 2024, 2025], notes);
    const gm = table.find((r) => r.id === "gross_margin")!;
    expect(gm.cells.map((c) => c.text)).toEqual(["—", "n/a", "24.5%"]);
    expect(gm.cells[1]).toMatchObject({ notApplicable: true, footnotes: [1] });
    expect(gm.cells[2]).toMatchObject({ footnotes: [2] });
    expect(notes.list().map((n) => n.text)).toEqual(["Cost of sales not reported", "53-week year"]);
  });
  it("keeps profile order and still shows metrics the profile no longer has", () => {
    const table = buildRatioTable(rows, retailProfile, [2025], new Footnotes());
    expect(table.slice(0, retailProfile.metrics.length).map((r) => r.id)).toEqual(retailProfile.metrics.map((m) => m.id));
    expect(table.at(-1)).toMatchObject({ id: "old_metric", cells: [{ text: "1.5" }] });
  });
});

describe("describeRedFlags", () => {
  it("labels flags from the profile, newest year first", () => {
    const flags = describeRedFlags(
      [
        { fiscal_year: 2023, rule: "negative_free_cash_flow", detail: "FCF −$1.0B", evidence: {} },
        { fiscal_year: 2025, rule: "gross_margin_drop", detail: "−2.5 pts", evidence: {} },
        { fiscal_year: 2025, rule: "retired_rule", detail: "x", evidence: {} },
      ],
      retailProfile,
    );
    expect(flags.map((f) => `${f.fiscalYear} ${f.rule}`)).toEqual([
      "2025 gross_margin_drop",
      "2025 retired_rule",
      "2023 negative_free_cash_flow",
    ]);
    expect(flags[0]!.label).toBe(retailProfile.redFlags.find((r) => r.id === "gross_margin_drop")!.label);
    expect(flags[1]!.threshold).toBe("Rule not in the current profile.");
  });
});

describe("profileTags", () => {
  it("collects every tag the profile can read", () => {
    const tags = profileTags(retailProfile);
    expect(tags.has("us-gaap:Revenues")).toBe(true);
    expect(tags.has("us-gaap:Goodwill")).toBe(false);
  });
});
