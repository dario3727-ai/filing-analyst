import { describe, expect, it } from "vitest";
import { matchRisks, normalizeTitle, similarity } from "./match.ts";
import type { Risk } from "./split.ts";

const risk = (index: number, title: string, body = "Body text about this risk."): Risk => ({ index, title, body, category: null, page: 1 });

describe("normalizeTitle", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normalizeTitle("We face  strong competition, from other retailers.")).toBe(normalizeTitle("we face strong competition from other retailers"));
  });
});

describe("matchRisks", () => {
  it("pairs same titles, spots rewording, and lists added and removed risks in this year's order", () => {
    const old = [
      risk(0, "We face strong competition from other retailers.", "Competition is intense."),
      risk(1, "The COVID-19 pandemic could disrupt our operations.", "Stores may close."),
      risk(2, "Tariffs could increase our costs.", "About half of our merchandise is imported from abroad, mostly from China."),
    ];
    const now = [
      risk(0, "We face strong competition from other retailers.", "Competition is intense."),
      risk(1, "Tariffs have increased, and could further increase, our costs.", "About half of our merchandise is imported from abroad, mostly from China."),
      risk(2, "Changes in AI search could reduce our digital traffic.", "Shoppers use AI agents."),
    ];
    const pairs = matchRisks(old, now);
    expect(pairs.map((p) => [p.kind, p.old?.index ?? null, p.new?.index ?? null])).toEqual([
      ["unchanged", 0, 0],
      ["removed", 1, null],
      ["modified", 2, 1],
      ["added", null, 2],
    ]);
    expect(pairs[2]!.similarity).toBeGreaterThan(0.45);
  });

  it("marks a same-title risk with new wording as modified", () => {
    const pairs = matchRisks([risk(0, "Tariffs could raise costs.", "They could.")], [risk(0, "Tariffs could raise costs.", "They have.")]);
    expect(pairs).toMatchObject([{ kind: "modified", similarity: 1 }]);
  });

  it("doesn't pair unrelated risks", () => {
    const a = risk(0, "Currency swings could hurt results.", "We operate in many countries.");
    const b = risk(0, "Cyberattacks could expose customer data.", "Hackers target retailers.");
    expect(similarity(a, b)).toBeLessThan(0.45);
    expect(matchRisks([a], [b]).map((p) => p.kind)).toEqual(["removed", "added"]);
  });
});
