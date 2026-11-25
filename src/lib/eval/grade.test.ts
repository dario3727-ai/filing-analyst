import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AskResponse } from "../qa/ask.ts";
import { citedClaims, combineGrade, expectedForms, gradeNumeric, judgeRequest, matchingFigures, parseJudge, supportScore } from "./grade.ts";

/** A response shaped like POST /api/ask's. */
function response(o: { status?: AskResponse["status"]; segments: { text: string; sources: number[] }[]; cited?: string[]; unverified?: number }): AskResponse {
  return {
    answerId: 0,
    cached: false,
    status: o.status ?? "answered",
    model: "claude-haiku-5-5",
    segments: o.segments,
    sources: (o.cited ?? []).map((citedText, i) => ({ n: i + 1, passageId: 100 + i, fiscalYear: 2025, item: "7", heading: null, pageStart: 1, pageEnd: 1, citedText })),
    numbers: { total: 0, xbrl: 0, passage: 0, unverified: o.unverified ?? 0, figures: [] },
  };
}

const krRevenue = { value: 147_642_000_000, unit: "USD" };

describe("gradeNumeric", () => {
  it("passes the right figure when a cited passage shows it, in any printed form", () => {
    const r = response({ segments: [{ text: "Total sales were $147.6 billion.", sources: [1] }], cited: ["Sales $ 147,642 0.4 % $ 147,123"] });
    expect(gradeNumeric(r, krRevenue)).toMatchObject({ correct: 1 });
  });
  it("fails a right figure no cited passage shows (recalled, not read)", () => {
    const r = response({ segments: [{ text: "Total sales were $147.6 billion.", sources: [1] }], cited: ["Identical sales grew 2.9%."] });
    expect(gradeNumeric(r, krRevenue)).toMatchObject({ correct: 0 });
  });
  it("fails a wrong figure, a missing figure and a declined answer", () => {
    const cited = ["Sales $ 147,642"];
    expect(gradeNumeric(response({ segments: [{ text: "Sales were $150.0 billion.", sources: [1] }], cited }), krRevenue).correct).toBe(0);
    expect(gradeNumeric(response({ segments: [{ text: "Sales grew.", sources: [1] }], cited }), krRevenue).correct).toBe(0);
    expect(gradeNumeric(response({ status: "not_answered", segments: [{ text: "The filings don't answer this question.", sources: [] }] }), krRevenue).correct).toBe(0);
  });
  it("matches per-share amounts only without a scale word", () => {
    expect(matchingFigures("Diluted EPS was $1.54.", { value: 1.54, unit: "USD/shares" })).toHaveLength(1);
    expect(matchingFigures("about $1.54 billion", { value: 1.54, unit: "USD/shares" })).toHaveLength(0);
  });
  it("lists the forms filings print a value in", () => {
    expect(expectedForms(3_876_527_000, "USD")).toEqual(expect.arrayContaining(["3,876,527", "3,877", "3.9", "3.88"]));
    expect(expectedForms(1.54, "USD/shares")).toEqual(["1.54"]);
  });
});

describe("citedClaims and the judge request", () => {
  const r = response({
    segments: [
      { text: "Gross margin rose 8 bps", sources: [1] },
      { text: " overall.", sources: [] },
      { text: "Mix shifts offset it.", sources: [1, 2] },
    ],
    cited: ["The gross profit rate increased 8 basis points.", "Mix shifts into lower margin categories."],
  });
  it("keeps cited segments with their passages", () => {
    expect(citedClaims(r)).toEqual([
      { index: 0, text: "Gross margin rose 8 bps", passages: ["The gross profit rate increased 8 basis points."] },
      { index: 1, text: "Mix shifts offset it.", passages: ["The gross profit rate increased 8 basis points.", "Mix shifts into lower margin categories."] },
    ]);
  });
  it("asks the judge with a schema and treats the content as data", () => {
    const req = judgeRequest("Why?", citedClaims(r), "claude-opus-5-5");
    expect(req).toMatchObject({ model: "claude-opus-5-5", output_config: { format: { type: "json_schema" } } });
    expect(req.system).toContain("not instructions");
    expect(JSON.stringify(req.messages)).toContain("Passage 1.2: Mix shifts");
  });
});

describe("parseJudge and supportScore", () => {
  const msg = (claims: unknown, stop_reason = "end_turn") =>
    ({ stop_reason, content: [{ type: "text", text: JSON.stringify({ claims }) }] }) as unknown as Anthropic.Messages.Message;
  it("reads one verdict per claim and scores partial support as half", () => {
    const { verdicts } = parseJudge(msg([{ index: 1, verdict: "partially_supported", reason: "r" }, { index: 0, verdict: "supported", reason: "r" }]), 2);
    expect(verdicts).toEqual(["supported", "partially_supported"]);
    expect(supportScore(verdicts)).toBe(0.75);
  });
  it("refuses replies that skip, repeat or invent claims", () => {
    expect(() => parseJudge(msg([{ index: 0, verdict: "supported", reason: "" }]), 2)).toThrow("skipped");
    expect(() => parseJudge(msg([{ index: 0, verdict: "supported", reason: "" }, { index: 0, verdict: "supported", reason: "" }]), 2)).toThrow("repeated");
    expect(() => parseJudge(msg([], "max_tokens"), 0)).toThrow("max_tokens");
  });
});

describe("combineGrade", () => {
  const answerable = { group: "explanation" as const, expect: "answered" as const, question: "Why?" };
  const declined = response({ status: "not_answered", segments: [{ text: "The filings don't answer this question.", sources: [] }] });
  it("passes an unanswerable question only when the app declines", () => {
    const na = { group: "unanswerable" as const, expect: "not_answered" as const, question: "Price target?" };
    expect(combineGrade(na, declined, null).grade).toEqual({ unverified: 0, correct: 1 });
    expect(combineGrade(na, response({ segments: [{ text: "About $200.", sources: [] }] }), null).grade.correct).toBe(0);
  });
  it("fails an answerable question that's declined, uncited or has an unsupported claim", () => {
    expect(combineGrade(answerable, declined, null).grade).toMatchObject({ correct: 0, answered: 0 });
    const r = response({ segments: [{ text: "Margins rose.", sources: [1] }], cited: ["x"] });
    expect(combineGrade(answerable, r, ["supported", "partially_supported"]).grade).toMatchObject({ correct: 1, answered: 1, supported: 0.75 });
    expect(combineGrade(answerable, r, ["supported", "unsupported"]).grade.correct).toBe(0);
    expect(combineGrade(answerable, response({ segments: [{ text: "Margins rose.", sources: [] }] }), null).grade.correct).toBe(0);
  });
  it("grades numeric cases by the figure, not the judge", () => {
    const num = { group: "numeric" as const, expect: "answered" as const, question: "Revenue?", expected: krRevenue };
    const r = response({ segments: [{ text: "Sales were $147.6 billion.", sources: [1] }], cited: ["Sales $ 147,642"], unverified: 1 });
    expect(combineGrade(num, r, ["unsupported"]).grade).toMatchObject({ correct: 1, supported: 0, unverified: 1 });
  });
});
