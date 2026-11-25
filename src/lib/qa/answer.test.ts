import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Passage } from "../search/hybrid.ts";
import {
  answerQuestion,
  buildRequest,
  DEV_MODEL,
  NOT_ANSWERED_OPENING,
  PARTLY_ANSWERED_OPENING,
  parseAnswer,
  passageTitle,
  QA_MODEL,
  type CreateMessage,
} from "./answer.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;

const passage = (id: number, overrides: Partial<Passage> = {}): Passage => ({
  id,
  filingId: 1,
  fiscalYear: 2025,
  item: "7",
  heading: "Margin",
  kind: "text",
  pageStart: 35,
  pageEnd: 35,
  content: `Passage ${id} text.`,
  semanticRank: 1,
  keywordRank: 1,
  score: 0.03,
  ...overrides,
});
const passages = [passage(101), passage(202, { item: "1A", heading: null, pageStart: 14, pageEnd: 15 })];
const ctx = { companyName: "Walmart Inc.", ticker: "WMT", fromYear: 2023, toYear: 2025 };

const cite = (index: number, source: string) => ({
  type: "search_result_location" as const,
  cited_text: `Passage text ${index}.`,
  source,
  title: "t",
  search_result_index: index,
  start_block_index: 0,
  end_block_index: 1,
});

/** A minimal API reply. Only the fields parseAnswer reads are filled in. */
function reply(content: unknown[], stop_reason = "end_turn"): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEV_MODEL,
    content,
    stop_reason,
    usage: { input_tokens: 1200, output_tokens: 80 },
  } as unknown as Message;
}

describe("buildRequest", () => {
  it("sends each passage as a cited search result whose source is its passage id, then the question", () => {
    const req = buildRequest("Why did margin change?", passages, { ...ctx, model: DEV_MODEL });
    // The SDK's content type is a wide union; the test only reads plain fields.
    const content = req.messages[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(content).toHaveLength(3);
    expect(content[0]).toMatchObject({
      type: "search_result",
      source: "chunk:101",
      title: "Walmart Inc. FY2025 10-K · Item 7 · Margin (p. 35)",
      content: [{ type: "text", text: "Passage 101 text." }],
      citations: { enabled: true },
    });
    expect(content[2]).toEqual({
      type: "text",
      text: "Company: Walmart Inc. (WMT). Filings searched: fiscal 2023–2025 10-Ks.\n\nQuestion: Why did margin change?",
    });
    expect(req).toMatchObject({ model: DEV_MODEL, max_tokens: 16_000, output_config: { effort: "medium" } });
    expect(req.system).toContain("only the passages");
    expect(req).not.toHaveProperty("fallbacks");
  });

  it("adds the refusal fallback for Sonnet 5.5 (the default model)", () => {
    const req = buildRequest("q", passages, ctx);
    expect(req).toMatchObject({ model: QA_MODEL, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  });

  it("titles multi-page passages without a heading", () => {
    expect(passageTitle(passages[1]!, "Walmart Inc.")).toBe("Walmart Inc. FY2025 10-K · Item 1A (pp. 14–15)");
  });
});

describe("parseAnswer", () => {
  it("maps citations back to passage ids and keeps the text in order", () => {
    const answer = parseAnswer(
      reply([
        { type: "thinking", thinking: "", signature: "s" },
        { type: "text", text: "Gross profit rate rose", citations: [cite(0, "chunk:101")] },
        { type: "text", text: " while risks grew.", citations: [cite(1, "chunk:202"), cite(0, "chunk:101")] },
      ]),
      passages,
    );
    expect(answer.status).toBe("answered");
    expect(answer.text).toBe("Gross profit rate rose while risks grew.");
    expect(answer.citedPassageIds).toEqual([101, 202]);
    expect(answer.segments[1]!.citations.map((c) => c.passageId)).toEqual([202, 101]);
    expect(answer).toMatchObject({ model: DEV_MODEL, inputTokens: 1200, outputTokens: 80, stopReason: "end_turn" });
  });

  it("treats an answer with no citations as not answered", () => {
    const answer = parseAnswer(reply([{ type: "text", text: "The filings don't say.", citations: null }]), passages);
    expect(answer).toMatchObject({ status: "not_answered", text: "The filings don't say.", citedPassageIds: [] });
  });

  it("uses the fixed openings even when the reply cites a passage", () => {
    // Real case: asked for the CEO's favorite color, Claude said the filing doesn't say and cited the CEO's bio.
    const not = parseAnswer(
      reply([
        { type: "text", text: `${NOT_ANSWERED_OPENING} It names the CEO: `, citations: null },
        { type: "text", text: "Ron M. Vachris.", citations: [cite(0, "chunk:101")] },
      ]),
      passages,
    );
    expect(not.status).toBe("not_answered");
    expect(not.citedPassageIds).toEqual([101]);
    const partly = parseAnswer(
      reply([{ type: "text", text: `${PARTLY_ANSWERED_OPENING} Margin rose.`, citations: [cite(0, "chunk:101")] }]),
      passages,
    );
    expect(partly.status).toBe("partly_answered");
  });

  it("puts the fixed openings in the system prompt", () => {
    const req = buildRequest("q", passages, ctx);
    expect(req.system).toContain(NOT_ANSWERED_OPENING);
    expect(req.system).toContain(PARTLY_ANSWERED_OPENING);
  });

  it("ignores a citation that doesn't match a passage we sent", () => {
    const answer = parseAnswer(
      reply([{ type: "text", text: "x", citations: [cite(5, "chunk:999"), cite(1, "chunk:101")] }]),
      passages,
    );
    expect(answer.status).toBe("not_answered");
  });

  it("reports refusals and cut-off answers instead of showing them as answers", () => {
    const declined = parseAnswer(reply([{ type: "text", text: "partial", citations: [cite(0, "chunk:101")] }], "refusal"), passages);
    expect(declined).toMatchObject({ status: "declined", text: "", segments: [] });
    const truncated = parseAnswer(reply([{ type: "text", text: "long", citations: [cite(0, "chunk:101")] }], "max_tokens"), passages);
    expect(truncated.status).toBe("truncated");
  });
});

describe("answerQuestion", () => {
  it("makes exactly one call", async () => {
    const calls: unknown[] = [];
    const createMessage: CreateMessage = async (params) => {
      calls.push(params);
      return reply([{ type: "text", text: "Yes.", citations: [cite(0, "chunk:101")] }]);
    };
    const answer = await answerQuestion("  Why?  ", passages, { ...ctx, model: DEV_MODEL }, { createMessage });
    expect(calls).toHaveLength(1);
    expect(answer.status).toBe("answered");
  });

  it("answers 'not answered' without calling Claude when search found nothing", async () => {
    const createMessage: CreateMessage = async () => {
      throw new Error("should not be called");
    };
    const answer = await answerQuestion("Why?", [], ctx, { createMessage });
    expect(answer).toMatchObject({ status: "not_answered", inputTokens: 0 });
  });

  it("rejects an empty question", async () => {
    const createMessage: CreateMessage = async () => reply([]);
    await expect(answerQuestion(" ", passages, ctx, { createMessage })).rejects.toThrow("Question is empty");
  });
});
