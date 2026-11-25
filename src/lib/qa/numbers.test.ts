import { describe, expect, it } from "vitest";
import { appearsInPassages, checkFigures, extractFigures, significantDigits, yearsNear, type CheckFact } from "./numbers.ts";

describe("significantDigits and yearsNear", () => {
  it("counts significant digits as written", () => {
    expect(["113", "1.0", "29,348", "2", "1000", "0.05", "4.52"].map(significantDigits)).toEqual([3, 2, 5, 1, 1, 1, 3]);
  });
  it("finds years only in the figure's own sentence", () => {
    const text = "Sales rose in 2024. The charge was $113 million in 2023 and fiscal 2022. Then 2021.";
    expect(yearsNear(text, text.indexOf("$113"))).toEqual([2023, 2022]);
  });
});

describe("extractFigures", () => {
  it("finds money with scale words, per-share amounts, percentages and basis points", () => {
    // Phrases from real answers in testing.
    const text =
      "The LIFO charge was $626 million in 2022 and $113 million in 2023. Net sales increased $8.5 billion or 7.0% " +
      "in fiscal 2026; the rate rose 40 basis points. Diluted EPS was $2.41. Comps were 3 percent, and 24.2 % of net sales.";
    const figures = extractFigures(text);
    expect(figures.map((f) => [f.raw, f.kind, f.value])).toEqual([
      ["$626 million", "usd", 626e6],
      ["$113 million", "usd", 113e6],
      ["$8.5 billion", "usd", 8.5e9],
      ["7.0%", "percent", 7],
      ["40 basis points", "bps", 40],
      ["$2.41", "usd", 2.41],
      ["3 percent", "percent", 3],
      ["24.2 %", "percent", 24.2],
    ]);
  });

  it("uses half a unit of the last digit written as the tolerance", () => {
    const [a, b, c] = extractFigures("$157 million, $8.5 billion and $2.41");
    expect(a).toMatchObject({ tolerance: 0.5e6, unscaled: false });
    expect(b!.tolerance).toBeCloseTo(0.05e9);
    expect(c!.tolerance).toBeCloseTo(0.005);
    expect(c!.unscaled).toBe(true);
  });

  it("reads commas, abbreviations and amounts without a dollar sign", () => {
    expect(extractFigures("$1,890 million").map((f) => f.value)).toEqual([1890e6]);
    expect(extractFigures("$681.0B in revenue").map((f) => f.value)).toEqual([681e9]);
    expect(extractFigures("revenue of 147.6 billion").map((f) => f.value)).toEqual([147.6e9]);
  });

  it("skips years, pages, item numbers and plain counts", () => {
    expect(extractFigures("In fiscal 2025 (Item 7, p. 35) the company had 10,000 stores and 2 segments.")).toEqual([]);
  });

  it("doesn't count one figure twice", () => {
    expect(extractFigures("$157 million")).toHaveLength(1);
  });
});

describe("appearsInPassages", () => {
  const [lifo, big, rate] = extractFigures("$157 million, $1,890 million, 24.2%");
  it("finds the digits as a whole number, with or without thousands commas", () => {
    expect(appearsInPassages(lifo!, ["Operating profit $ 1,890 $ 3,849 LIFO charge 157 95"])).toBe(true);
    expect(appearsInPassages(big!, ["Operating profit 1890"])).toBe(true);
    expect(appearsInPassages(rate!, ["was 24.2 % of net sales"])).toBe(true);
  });
  it("doesn't match inside longer numbers", () => {
    expect(appearsInPassages(lifo!, ["1,157 and 157.5 and 2157"])).toBe(false);
    expect(appearsInPassages(rate!, ["124.2% and 24.25%"])).toBe(false);
  });
});

describe("checkFigures", () => {
  // Synthetic facts, not a real company's.
  const facts: CheckFact[] = [
    { concept: "us-gaap:Revenues", unit: "USD", value: 147_600_000_000, fiscalYear: 2025 },
    { concept: "us-gaap:InventoryLIFOReserveEffectOnIncomeNet", unit: "USD", value: -157_000_000, fiscalYear: 2025 },
    { concept: "us-gaap:EarningsPerShareDiluted", unit: "USD/shares", value: 1.546, fiscalYear: 2025 },
    { concept: "us-gaap:EffectiveIncomeTaxRateContinuingOperations", unit: "pure", value: 0.226, fiscalYear: 2025 },
    { concept: "us-gaap:PaymentsForRepurchaseOfCommonStock", unit: "USD", value: 0, fiscalYear: 2023 },
  ];

  it("matches XBRL within the rounding written, ignoring sign, and keeps the matched concept", () => {
    const result = checkFigures("Revenue was $147.6 billion and the LIFO charge $157 million.", facts, []);
    expect(result).toMatchObject({ total: 2, xbrl: 2, passage: 0, unverified: 0 });
    expect(result.figures[1]!.match?.concept).toBe("us-gaap:InventoryLIFOReserveEffectOnIncomeNet");
  });

  it("matches per-share amounts only when no scale word is written", () => {
    expect(checkFigures("Diluted EPS was $1.55.", facts, []).figures[0]!.status).toBe("xbrl");
    expect(checkFigures("about $1.55 billion", facts, []).figures[0]!.status).toBe("unverified");
  });

  it("never compares percentages with XBRL (a 3% matched a 2.5% tax-rate line in testing)", () => {
    const result = checkFigures("The tax rate was 22.6%.", facts, ["effective rate of 22.6%"]);
    expect(result.figures[0]).toMatchObject({ status: "passage" });
    expect(result.figures[0]!.match).toBeUndefined();
  });

  describe("ambiguous values (real Kroger cases)", () => {
    // Kroger's $113 million LIFO charge (2023) has the same value as a 2025 receivables change.
    const kroger: CheckFact[] = [
      { concept: "us-gaap:IncreaseDecreaseInReceivables", unit: "USD", value: -113_000_000, fiscalYear: 2025 },
      { concept: "us-gaap:InventoryLIFOReservePeriodCharge", unit: "USD", value: 113_000_000, fiscalYear: 2023 },
      { concept: "us-gaap:InventoryLIFOReservePeriodCharge", unit: "USD", value: 157_000_000, fiscalYear: 2025 },
      { concept: "us-gaap:ShareBasedCompensation", unit: "USD", value: 157_000_000, fiscalYear: 2025 },
    ];

    it("uses a year in the same sentence to pick the fact", () => {
      const result = checkFigures("The LIFO charge was $113 million in 2023. Receivables changed.", kroger, []);
      expect(result.figures[0]).toMatchObject({
        status: "xbrl",
        match: { concept: "us-gaap:InventoryLIFOReservePeriodCharge", fiscalYear: 2023 },
      });
    });

    it("also accepts the year before, for 'fiscal 2026' naming", () => {
      const result = checkFigures("In fiscal 2024 the charge was $113 million.", kroger, []);
      expect(result.figures[0]!.match?.fiscalYear).toBe(2023);
    });

    it("doesn't count a value several facts share; falls back to the text and says how many", () => {
      const result = checkFigures("In 2025 the charge rose to $157 million.", kroger, ["LIFO charge 157 95"]);
      expect(result.figures[0]).toMatchObject({ status: "passage", xbrlCandidates: 2 });
      expect(checkFigures("The charge was $113 million.", kroger, []).figures[0]).toMatchObject({
        status: "unverified",
        xbrlCandidates: 2,
      });
    });

    it("needs at least 3 significant digits (a unique '$1.3 billion' match was a coincidence in testing)", () => {
      const one: CheckFact[] = [{ concept: "us-gaap:Goodwill", unit: "USD", value: 2_050_000_000, fiscalYear: 2025 }];
      expect(checkFigures("about $2 billion", one, []).figures[0]!.status).toBe("unverified");
      expect(checkFigures("about $2.1 billion", one, []).figures[0]!.status).toBe("unverified");
      expect(checkFigures("about $2.05 billion", one, []).figures[0]!.status).toBe("xbrl");
    });
  });

  it("falls back to the passages, then marks the rest unverified", () => {
    const passages = ["Gross profit rate increased 22 basis points. Net sales increased $8.5 billion or 7.0%."];
    const result = checkFigures("It rose 22 basis points, sales grew $8.5 billion (7.0%), and margin was 31.4%.", facts, passages);
    expect(result.figures.map((f) => [f.figure.raw, f.status])).toEqual([
      ["22 basis points", "passage"],
      ["$8.5 billion", "passage"],
      ["7.0%", "passage"],
      ["31.4%", "unverified"],
    ]);
    expect(result).toMatchObject({ total: 4, xbrl: 0, passage: 3, unverified: 1 });
  });

  it("doesn't count $0 as an XBRL match, and rejects a figure outside the rounding", () => {
    expect(checkFigures("Buybacks were $0.", facts, []).figures[0]!.status).toBe("unverified");
    expect(checkFigures("Revenue was $147.7 billion.", facts, []).figures[0]!.status).toBe("unverified");
  });

  it("handles an answer with no figures", () => {
    expect(checkFigures("The filings don't answer this question.", facts, [])).toMatchObject({ total: 0, unverified: 0 });
  });
});
