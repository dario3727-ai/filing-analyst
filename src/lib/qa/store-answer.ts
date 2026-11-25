/**
 * Saves each Q&A result to the private `answers` table (CLAUDE.md: "Store
 * every AI result"). `toAnswerRow` is pure; `saveAnswer` needs a client
 * made with the secret key, because the browser key can't touch the table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Passage } from "../search/hybrid.ts";
import type { Answer } from "./answer.ts";
import type { NumberCheck } from "./numbers.ts";

export interface AnswerRecordInput {
  companyId: number;
  fromYear: number;
  toYear: number;
  question: string;
  answer: Answer;
  passages: readonly Passage[];
  check: NumberCheck;
  latencyMs?: number;
}

export interface AnswerRow {
  company_id: number;
  from_year: number;
  to_year: number;
  question: string;
  status: Answer["status"];
  answer: string;
  segments: Answer["segments"];
  citations: { passageId: number; fiscalYear: number; item: string; pageStart: number; pageEnd: number; citedText: string }[];
  passages_sent: { passageId: number; fiscalYear: number; item: string; semanticRank: number | null; keywordRank: number | null; score: number }[];
  numbers_checked: {
    total: number;
    xbrl: number;
    passage: number;
    unverified: number;
    figures: {
      raw: string;
      kind: string;
      value: number;
      status: string;
      concept?: string;
      fiscalYear?: number;
      xbrlCandidates?: number;
    }[];
  };
  model: string;
  stop_reason: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number | null;
}

export function toAnswerRow(input: AnswerRecordInput): AnswerRow {
  const { answer, passages, check } = input;
  const byId = new Map(passages.map((p) => [p.id, p]));
  // First cited text per passage (each passage is one citable block, so it's the whole passage).
  const citedText = new Map<number, string>();
  for (const s of answer.segments) for (const c of s.citations) if (!citedText.has(c.passageId)) citedText.set(c.passageId, c.citedText);

  return {
    company_id: input.companyId,
    from_year: input.fromYear,
    to_year: input.toYear,
    question: input.question.trim(),
    status: answer.status,
    answer: answer.text,
    segments: answer.segments,
    citations: answer.citedPassageIds.flatMap((id) => {
      const p = byId.get(id);
      return p
        ? [{ passageId: id, fiscalYear: p.fiscalYear, item: p.item, pageStart: p.pageStart, pageEnd: p.pageEnd, citedText: citedText.get(id) ?? p.content }]
        : [];
    }),
    passages_sent: passages.map((p) => ({
      passageId: p.id,
      fiscalYear: p.fiscalYear,
      item: p.item,
      semanticRank: p.semanticRank,
      keywordRank: p.keywordRank,
      score: p.score,
    })),
    numbers_checked: {
      total: check.total,
      xbrl: check.xbrl,
      passage: check.passage,
      unverified: check.unverified,
      figures: check.figures.map((f) => ({
        raw: f.figure.raw,
        kind: f.figure.kind,
        value: f.figure.value,
        status: f.status,
        ...(f.match ? { concept: f.match.concept, fiscalYear: f.match.fiscalYear } : {}),
        ...(f.xbrlCandidates ? { xbrlCandidates: f.xbrlCandidates } : {}),
      })),
    },
    model: answer.model,
    stop_reason: answer.stopReason,
    input_tokens: answer.inputTokens,
    output_tokens: answer.outputTokens,
    latency_ms: input.latencyMs === undefined ? null : Math.max(0, Math.round(input.latencyMs)),
  };
}

/** Inserts the row and returns its id. Use a secret-key client (server code only). */
export async function saveAnswer(db: SupabaseClient, row: AnswerRow): Promise<number> {
  const { data, error } = await db.from("answers").insert(row).select("id").single();
  if (error) throw new Error(`Saving the answer failed: ${error.message}`);
  return Number((data as { id: number | string }).id);
}
