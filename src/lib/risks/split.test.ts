import { describe, expect, it } from "vitest";
import type { Block } from "../filings/blocks.ts";
import { parseFiling } from "../filings/sections.ts";
import { FILING_FIXTURES, loadFilingBytes } from "../../../tests/filing-fixtures";
import { blockRole, splitRisks } from "./split.ts";

const text = (t: string, page = 1): Block => ({ text: t, page, kind: "text" });
const bold = (t: string, page = 1): Block => ({ text: t, page, kind: "text", emphasis: true });

describe("blockRole", () => {
  it("tells titles, headings and body apart", () => {
    expect(blockRole(bold("We face strong competition from other retailers."))).toBe("title");
    expect(blockRole(bold("Strategic Risks"))).toBe("heading");
    expect(blockRole(text("We face strong competition from other retailers."))).toBe("body");
    expect(blockRole(bold(`${"word ".repeat(100)}end.`))).toBe("body"); // a bold intro paragraph
    expect(blockRole(bold("•identify suitable sites"))).toBe("body");
    expect(blockRole({ text: "2025 2024", page: 1, kind: "table", emphasis: true })).toBe("body");
  });
});

describe("splitRisks", () => {
  it("starts a risk at each bold title, under its category, and drops the intro", () => {
    const risks = splitRisks([
      text("The risks described below could materially affect us."),
      bold("Strategic Risks"),
      bold("We face strong competition from other retailers.", 13),
      text("Each segment competes for customers.", 13),
      text("We compete on price and selection.", 14),
      bold("Tariffs could raise our costs and prices.", 14),
      text("About half of our goods are imported.", 14),
      bold("Financial Risks"),
      bold("Currency swings could hurt our results.", 15),
      text("We operate in many countries.", 15),
    ]);
    expect(risks).toEqual([
      {
        index: 0,
        title: "We face strong competition from other retailers.",
        category: "Strategic Risks",
        body: "Each segment competes for customers.\n\nWe compete on price and selection.",
        page: 13,
      },
      { index: 1, title: "Tariffs could raise our costs and prices.", category: "Strategic Risks", body: "About half of our goods are imported.", page: 14 },
      { index: 2, title: "Currency swings could hurt our results.", category: "Financial Risks", body: "We operate in many countries.", page: 15 },
    ]);
  });

  it("uses the headings as risks when there are no title sentences (the Kroger layout)", () => {
    const risks = splitRisks([
      text("There are risks that can affect our business."),
      bold("COMPETITIVE ENVIRONMENT"),
      text("The operating environment continues to change."),
      text("We are enhancing our connection with customers."),
      bold("PRODUCT SAFETY"),
      text("Customers count on us to provide safe food."),
    ]);
    expect(risks.map((r) => [r.title, r.category, r.body.split("\n\n").length])).toEqual([
      ["COMPETITIVE ENVIRONMENT", null, 2],
      ["PRODUCT SAFETY", null, 1],
    ]);
  });

  it("splits every fixture 10-K into a plausible number of risks", () => {
    const counts = Object.fromEntries(
      FILING_FIXTURES.map((f) => {
        const section = parseFiling(loadFilingBytes(f.ticker, f.fiscalYear)).sections.find((s) => s.item === "1A")!;
        return [f.ticker, splitRisks(section.blocks).length];
      }),
    );
    // Bold title sentences per filing (Kroger: its 14 ALL-CAPS headings).
    for (const [ticker, n] of Object.entries(counts)) expect(n, ticker).toBeGreaterThanOrEqual(14);
    for (const [ticker, n] of Object.entries(counts)) expect(n, ticker).toBeLessThanOrEqual(40);
  });
});
