/**
 * Q&A: a question plus the passages hybrid search found → Claude's answer
 * with citations (decisions 2026-11-24).
 *  - Each passage is sent as a `search_result` block whose source is
 *    "chunk:<id>", so every citation points back to one stored passage.
 *  - Status: Claude opens with a fixed sentence when the filings don't (or
 *    only partly) answer, and the code checks for it. An answer with no
 *    citation also counts as "not answered": nothing in it can be checked.
 *  - One request per question, no loop. Citations only: structured output
 *    (if ever needed) is a separate call, per CLAUDE.md.
 *  - Models (CLAUDE.md): Haiku while developing, Sonnet for Q&A. Sonnet 5.5
 *    gets the server-side refusal fallback; a refusal that still happens is
 *    reported as "declined", never shown as an answer.
 * The API call is passed in, so tests run without the network.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Passage } from "../search/hybrid.ts";

export const DEV_MODEL = "claude-haiku-5-5";
export const QA_MODEL = "claude-sonnet-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_TOKENS = 16_000;

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

export type CreateMessage = (params: CreateParams) => Promise<Message>;

export interface AnswerContext {
  /** e.g. "Walmart Inc." */
  companyName: string;
  ticker: string;
  fromYear: number;
  toYear: number;
  model?: string;
}

export interface Citation {
  passageId: number;
  /** The passage text Claude cited (one whole passage: each passage is one block). */
  citedText: string;
}

export interface AnswerSegment {
  text: string;
  citations: Citation[];
}

export type AnswerStatus = "answered" | "partly_answered" | "not_answered" | "declined" | "truncated";

/** Fixed openings Claude is told to use, so the status never depends on reading free text. */
export const NOT_ANSWERED_OPENING = "The filings don't answer this question.";
export const PARTLY_ANSWERED_OPENING = "The filings only partly answer this question.";

export interface Answer {
  status: AnswerStatus;
  /** The answer split where citations start and stop, in order. */
  segments: AnswerSegment[];
  text: string;
  /** Distinct cited passages, in first-cited order. */
  citedPassageIds: number[];
  model: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

export const SYSTEM_PROMPT = `You answer questions about one company's annual reports (10-K filings), using only the passages provided as search results. Refer to them as "the filing", not as search results.

- Base every statement on the passages, so each one is supported by a citation. Do not use outside knowledge about the company, its industry, markets or news.
- If the passages don't contain the answer, begin your reply with exactly "${NOT_ANSWERED_OPENING}" and then, in at most one more sentence, say what the filing does cover. Do not guess.
- If they answer only part of the question, begin with exactly "${PARTLY_ANSWERED_OPENING}", answer that part, and say what is missing.
- Some search results are the company's reported financial data (XBRL) for a fiscal year, one figure each. For a financial figure, quote it from there and cite it.
- Use figures exactly as the passages state them. Do not calculate new figures; reported numbers are checked against XBRL data separately.
- Write in your own words and quote only short phrases; never repeat a passage's sentences after summarizing them.
- Keep it short: a few short paragraphs at most, plain prose, no headings or bullet lists.
- Describe what the filing says; do not give investment advice or recommendations.`;

/** "Walmart Inc. FY2025 10-K · Item 7 · Margin (p. 35)" */
export function passageTitle(p: Passage, companyName: string): string {
  if (p.kind === "xbrl") return `${companyName} FY${p.fiscalYear} reported financial data (XBRL) · ${p.heading}`;
  const pages = p.pageStart === p.pageEnd ? `p. ${p.pageStart}` : `pp. ${p.pageStart}–${p.pageEnd}`;
  return `${companyName} FY${p.fiscalYear} 10-K · Item ${p.item}${p.heading ? ` · ${p.heading}` : ""} (${pages})`;
}

export function buildRequest(question: string, passages: readonly Passage[], ctx: AnswerContext): CreateParams {
  const model = ctx.model ?? QA_MODEL;
  const years = ctx.fromYear === ctx.toYear ? `fiscal ${ctx.fromYear}` : `fiscal ${ctx.fromYear}–${ctx.toYear}`;
  return {
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...passages.map((p) => ({
            type: "search_result" as const,
            source: `chunk:${p.id}`,
            title: passageTitle(p, ctx.companyName),
            content: [{ type: "text" as const, text: p.content }],
            citations: { enabled: true },
          })),
          {
            type: "text" as const,
            text: `Company: ${ctx.companyName} (${ctx.ticker}). Filings searched: ${years} 10-Ks.\n\nQuestion: ${question}`,
          },
        ],
      },
    ],
    // Sonnet 5.5: if a safety classifier declines, the API re-runs the request on a fallback model.
    ...(model === QA_MODEL ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

/** Reads Claude's reply: text segments with citations mapped back to passage ids. */
export function parseAnswer(message: Message, passages: readonly Passage[]): Answer {
  const segments: AnswerSegment[] = [];
  for (const block of message.content) {
    if (block.type !== "text") continue; // thinking and fallback blocks carry no answer text
    const citations: Citation[] = [];
    for (const c of block.citations ?? []) {
      if (c.type !== "search_result_location") continue;
      const passage = passages[c.search_result_index];
      // Ignore a citation that doesn't point at a passage we sent (never expected).
      if (passage && c.source === `chunk:${passage.id}`) citations.push({ passageId: passage.id, citedText: c.cited_text });
    }
    segments.push({ text: block.text, citations });
  }
  const citedPassageIds = [...new Set(segments.flatMap((s) => s.citations.map((c) => c.passageId)))];
  const stopReason = message.stop_reason;
  const opening = segments.map((s) => s.text).join("").trimStart();
  const status: AnswerStatus =
    stopReason === "refusal"
      ? "declined"
      : stopReason === "max_tokens"
        ? "truncated"
        : opening.startsWith(NOT_ANSWERED_OPENING) || citedPassageIds.length === 0
          ? "not_answered" // also: nothing cited means nothing in it can be checked
          : opening.startsWith(PARTLY_ANSWERED_OPENING)
            ? "partly_answered"
            : "answered";
  return {
    status,
    segments: status === "declined" ? [] : segments,
    text: status === "declined" ? "" : segments.map((s) => s.text).join(""),
    citedPassageIds,
    model: message.model,
    stopReason,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

export async function answerQuestion(
  question: string,
  passages: readonly Passage[],
  ctx: AnswerContext,
  deps: { createMessage: CreateMessage },
): Promise<Answer> {
  const q = question.trim();
  if (q === "") throw new Error("Question is empty");
  if (passages.length === 0) {
    // Nothing to ground an answer in: say so without calling Claude.
    return {
      status: "not_answered",
      segments: [{ text: "No passages from the filings matched this question.", citations: [] }],
      text: "No passages from the filings matched this question.",
      citedPassageIds: [],
      model: ctx.model ?? QA_MODEL,
      stopReason: null,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
  const message = await deps.createMessage(buildRequest(q, passages, ctx));
  return parseAnswer(message, passages);
}
