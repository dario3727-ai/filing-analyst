import { describe, expect, it } from "vitest";
import type { Passage } from "../search/hybrid.ts";
import type { Answer } from "./answer.ts";
import { createRateLimiter, handleAsk, normalizeQuestion, parseAskRequest, type AskDeps } from "./ask.ts";
import type { AnswerRow } from "./store-answer.ts";

const passages: Passage[] = [
  {
    id: 11,
    filingId: 9,
    fiscalYear: 2025,
    item: "7",
    heading: "Margin",
    kind: "text",
    pageStart: 35,
    pageEnd: 35,
    content: "The LIFO charge was $157 million.",
    semanticRank: 1,
    keywordRank: 2,
    score: 0.03,
  },
];

const answer: Answer = {
  status: "answered",
  segments: [
    { text: "The charge was $157 million.", citations: [{ passageId: 11, citedText: "The LIFO charge was $157 million." }] },
    { text: " That's all.", citations: [] },
  ],
  text: "The charge was $157 million. That's all.",
  citedPassageIds: [11],
  model: "claude-haiku-5-5",
  stopReason: "end_turn",
  inputTokens: 100,
  outputTokens: 20,
};

const body = { ticker: "kr", question: "What was the LIFO charge?", fromYear: 2023, toYear: 2025 };

/** Fake services that record what was called. */
function fakeDeps(overrides: Partial<AskDeps> = {}) {
  const calls: string[] = [];
  const saved: AnswerRow[] = [];
  const deps: AskDeps = {
    model: "claude-haiku-5-5",
    dailyLimit: 50,
    now: () => new Date("2026-11-24T15:00:00Z"),
    findCompany: async (t) => (calls.push(`company:${t}`), t === "KR" ? { id: 4, name: "Kroger Co", ticker: "KR" } : null),
    recentAnswers: async () => (calls.push("recent"), []),
    countAnswersSince: async (since) => (calls.push(`count:${since.toISOString()}`), 0),
    search: async (q, o) => (calls.push(`search:${o.companyId}:${o.fromYear}-${o.toYear}:${o.limit}`), passages),
    answer: async (_q, _p, ctx) => (calls.push(`answer:${ctx.model}`), answer),
    loadFacts: async () => (calls.push("facts"), [{ concept: "us-gaap:InventoryLIFOReservePeriodCharge", unit: "USD", value: 157e6, fiscalYear: 2025 }]),
    save: async (row) => (calls.push("save"), saved.push(row), 77),
    ...overrides,
  };
  return { deps, calls, saved };
}

describe("parseAskRequest", () => {
  it("accepts a valid body and normalizes the ticker", () => {
    expect(parseAskRequest({ ...body, question: "  Why?  " })).toEqual({
      ok: true,
      value: { ticker: "KR", question: "Why?", fromYear: 2023, toYear: 2025 },
    });
  });
  it("rejects bad input with a clear message", () => {
    expect(parseAskRequest(null)).toMatchObject({ ok: false, error: "Send a JSON object." });
    expect(parseAskRequest({ ...body, ticker: "<script>" })).toMatchObject({ ok: false });
    expect(parseAskRequest({ ...body, question: " " })).toMatchObject({ ok: false, error: "question is missing." });
    expect(parseAskRequest({ ...body, question: "x".repeat(1001) })).toMatchObject({ ok: false });
    expect(parseAskRequest({ ...body, fromYear: 2025, toYear: 2023 })).toMatchObject({ ok: false });
    expect(parseAskRequest({ ...body, fromYear: "2023" })).toMatchObject({ ok: false });
  });
});

describe("normalizeQuestion", () => {
  it("ignores case and extra spaces", () => {
    expect(normalizeQuestion("  Why did   Margin fall? ")).toBe("why did margin fall?");
  });
});

describe("handleAsk", () => {
  it("searches, answers, checks numbers, saves and returns numbered sources", async () => {
    const { deps, calls, saved } = fakeDeps();
    const result = await handleAsk(body, deps);
    expect(calls).toEqual([
      "company:KR",
      "recent",
      "count:2026-11-24T00:00:00.000Z", // the daily cap counts from UTC midnight
      "search:4:2023-2025:8",
      "answer:claude-haiku-5-5",
      "facts",
      "save",
    ]);
    expect(result).toEqual({
      ok: true,
      response: {
        answerId: 77,
        cached: false,
        status: "answered",
        model: "claude-haiku-5-5",
        segments: [
          { text: "The charge was $157 million.", sources: [1] },
          { text: " That's all.", sources: [] },
        ],
        sources: [
          {
            n: 1,
            passageId: 11,
            fiscalYear: 2025,
            item: "7",
            heading: "Margin",
            pageStart: 35,
            pageEnd: 35,
            citedText: "The LIFO charge was $157 million.",
          },
        ],
        numbers: saved[0]!.numbers_checked,
      },
    });
    expect(saved[0]!.numbers_checked).toMatchObject({ total: 1, xbrl: 1 });
  });

  it("reuses a recent identical answer without any AI call", async () => {
    const first = fakeDeps();
    await handleAsk(body, first.deps);
    const stored = first.saved[0]!;
    const { deps, calls } = fakeDeps({ recentAnswers: async () => [{ id: 5, row: { ...stored, question: "what was the  LIFO charge?" } }] });
    const result = await handleAsk(body, deps);
    expect(result).toMatchObject({ ok: true, response: { answerId: 5, cached: true, status: "answered" } });
    // No search, no Claude call, no daily-limit count, nothing saved.
    expect(calls).toEqual(["company:KR"]);
  });

  it("doesn't reuse a declined answer", async () => {
    const first = fakeDeps();
    await handleAsk(body, first.deps);
    const declined = { ...first.saved[0]!, status: "declined" as const };
    const { deps, calls } = fakeDeps({ recentAnswers: async () => [{ id: 5, row: declined }] });
    await handleAsk(body, deps);
    expect(calls).toContain("answer:claude-haiku-5-5");
  });

  it("returns 400 for bad input and 404 for an unknown ticker, before any paid call", async () => {
    const bad = fakeDeps();
    expect(await handleAsk({ ticker: "KR" }, bad.deps)).toMatchObject({ ok: false, status: 400 });
    expect(bad.calls).toEqual([]);
    const unknown = fakeDeps();
    expect(await handleAsk({ ...body, ticker: "AAPL" }, unknown.deps)).toMatchObject({ ok: false, status: 404, error: "AAPL is not loaded." });
    expect(unknown.calls).toEqual(["company:AAPL"]);
  });

  it("stops at the daily limit with 429", async () => {
    const { deps, calls } = fakeDeps({ countAnswersSince: async () => 50 });
    expect(await handleAsk(body, deps)).toMatchObject({ ok: false, status: 429 });
    expect(calls).not.toContain("answer:claude-haiku-5-5");
  });

  it("turns a search or Claude failure into a plain 502 without saving", async () => {
    const { deps, calls } = fakeDeps({
      answer: async () => {
        throw new Error("Anthropic 529 overloaded");
      },
    });
    const original = console.error;
    console.error = () => undefined; // keep the expected log out of the test output
    try {
      const result = await handleAsk(body, deps);
      expect(result).toEqual({
        ok: false,
        status: 502,
        error: "The answer service is unavailable right now. Try again in a minute.",
      });
    } finally {
      console.error = original;
    }
    expect(calls).not.toContain("save");
  });
});

describe("createRateLimiter", () => {
  it("allows max requests per window per key, then frees up", () => {
    const allow = createRateLimiter(2, 60_000);
    expect([allow("a", 0), allow("a", 1), allow("a", 2), allow("b", 3)]).toEqual([true, true, false, true]);
    expect(allow("a", 60_001)).toBe(true);
  });
});
