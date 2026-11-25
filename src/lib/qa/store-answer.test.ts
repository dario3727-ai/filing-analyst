import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Passage } from "../search/hybrid.ts";
import type { Answer } from "./answer.ts";
import { checkFigures } from "./numbers.ts";
import { saveAnswer, toAnswerRow } from "./store-answer.ts";

const passage = (id: number, item: string, rank: number | null): Passage => ({
  id,
  filingId: 9,
  fiscalYear: 2025,
  item,
  heading: null,
  kind: "text",
  pageStart: 34,
  pageEnd: 35,
  content: `Passage ${id}: the LIFO charge was $157 million.`,
  semanticRank: rank,
  keywordRank: null,
  score: 0.016,
});
const passages = [passage(11, "7", 1), passage(22, "1A", 2)];

const answer: Answer = {
  status: "answered",
  segments: [
    { text: "The LIFO charge was $157 million.", citations: [{ passageId: 11, citedText: "Passage 11 cited." }] },
    { text: " Risks rose.", citations: [{ passageId: 11, citedText: "Passage 11 cited." }] },
  ],
  text: "The LIFO charge was $157 million. Risks rose.",
  citedPassageIds: [11],
  model: "claude-haiku-5-5",
  stopReason: "end_turn",
  inputTokens: 5000,
  outputTokens: 700,
};

describe("toAnswerRow", () => {
  it("records the question, answer, citations with their text, every passage sent and the number check", () => {
    const check = checkFigures(answer.text, [], passages.map((p) => p.content));
    const row = toAnswerRow({ companyId: 3, fromYear: 2023, toYear: 2025, question: "  Why?  ", answer, passages, check, latencyMs: 2345.6 });
    expect(row).toMatchObject({
      company_id: 3,
      from_year: 2023,
      to_year: 2025,
      question: "Why?",
      status: "answered",
      answer: "The LIFO charge was $157 million. Risks rose.",
      model: "claude-haiku-5-5",
      stop_reason: "end_turn",
      input_tokens: 5000,
      output_tokens: 700,
      latency_ms: 2346,
    });
    expect(row.citations).toEqual([
      { passageId: 11, fiscalYear: 2025, item: "7", heading: null, pageStart: 34, pageEnd: 35, citedText: "Passage 11 cited." },
    ]);
    expect(row.passages_sent.map((p) => [p.passageId, p.semanticRank])).toEqual([
      [11, 1],
      [22, 2],
    ]);
    expect(row.numbers_checked).toEqual({
      total: 1,
      xbrl: 0,
      passage: 1,
      unverified: 0,
      figures: [{ raw: "$157 million", kind: "usd", value: 157e6, status: "passage" }],
    });
    expect(row.segments).toBe(answer.segments);
  });

  it("keeps the matched XBRL concept and leaves latency empty when unknown", () => {
    const facts = [{ concept: "us-gaap:InventoryLIFOReservePeriodCharge", unit: "USD", value: 157e6, fiscalYear: 2025 }];
    const row = toAnswerRow({
      companyId: 3,
      fromYear: 2025,
      toYear: 2025,
      question: "q",
      answer,
      passages,
      check: checkFigures(answer.text, facts, []),
    });
    expect(row.numbers_checked.figures[0]).toMatchObject({
      status: "xbrl",
      concept: "us-gaap:InventoryLIFOReservePeriodCharge",
      fiscalYear: 2025,
    });
    expect(row.latency_ms).toBeNull();
  });
});

describe("saveAnswer", () => {
  /** Just enough of supabase-js's insert → select → single chain. */
  function fakeDb(result: { data: unknown; error: { message: string } | null }) {
    const inserted: unknown[] = [];
    const db = {
      from: (table: string) => ({
        insert: (row: unknown) => {
          inserted.push({ table, row });
          return { select: () => ({ single: async () => result }) };
        },
      }),
    } as unknown as SupabaseClient;
    return { db, inserted };
  }

  it("inserts into answers and returns the new id", async () => {
    const { db, inserted } = fakeDb({ data: { id: "42" }, error: null });
    const row = toAnswerRow({ companyId: 1, fromYear: 2025, toYear: 2025, question: "q", answer, passages, check: checkFigures("", [], []) });
    expect(await saveAnswer(db, row)).toBe(42);
    expect(inserted).toEqual([{ table: "answers", row }]);
  });

  it("surfaces database errors", async () => {
    const { db } = fakeDb({ data: null, error: { message: "permission denied for table answers" } });
    const row = toAnswerRow({ companyId: 1, fromYear: 2025, toYear: 2025, question: "q", answer, passages, check: checkFigures("", [], []) });
    await expect(saveAnswer(db, row)).rejects.toThrow("Saving the answer failed: permission denied");
  });
});
