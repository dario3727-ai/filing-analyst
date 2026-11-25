import { describe, expect, it } from "vitest";
import { parsePassageId, toSectionView } from "./section.ts";

describe("toSectionView", () => {
  it("builds the panel view: filing link, section, passages in order", () => {
    const view = toSectionView({
      section: { item: "7", title: "MANAGEMENT'S DISCUSSION", page_start: 33, page_end: 46 },
      filing: {
        fiscal_year: 2025,
        form: "10-K",
        period_end: "2026-01-31",
        filed_at: "2026-03-13",
        accession_no: "0000104169-26-000010",
        primary_document: "wmt-20260131.htm",
      },
      company: { cik: "0000104169", name: "Walmart Inc.", ticker: "WMT" },
      chunks: [
        { id: "12", chunk_index: 1, kind: "table", heading: "Margin", page_start: 35, page_end: 35, content: "2026 2025 24.2 % 24.1 %" },
        { id: "11", chunk_index: 0, kind: "text", heading: null, page_start: 33, page_end: 33, content: "Overview text." },
      ],
    });
    expect(view.filing.secUrl).toBe("https://www.sec.gov/Archives/edgar/data/104169/000010416926000010/wmt-20260131.htm");
    expect(view.section).toEqual({ item: "7", title: "MANAGEMENT'S DISCUSSION", pageStart: 33, pageEnd: 46 });
    expect(view.passages.map((p) => [p.id, p.kind])).toEqual([
      [11, "text"],
      [12, "table"],
    ]);
    expect(view.company).toEqual({ name: "Walmart Inc.", ticker: "WMT" });
  });
});

describe("parsePassageId", () => {
  it("accepts positive whole numbers only", () => {
    expect(parsePassageId("5974")).toBe(5974);
    expect([parsePassageId(null), parsePassageId("0"), parsePassageId("-1"), parsePassageId("1.5"), parsePassageId("abc")]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
