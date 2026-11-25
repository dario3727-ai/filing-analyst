/**
 * The whole Ask pipeline behind POST /api/ask (decisions 2026-11-24):
 *   validate → reuse a recent identical answer → daily cap → search →
 *   Claude → number check → save → response.
 * Every outside service is passed in (`AskDeps`), so tests run with fakes
 * and the route file only wires real clients. The response has the same
 * shape whether the answer is new or reused.
 */
import { companyTerms, type Passage, type SearchOptions } from "../search/hybrid.ts";
import type { Answer, AnswerContext } from "./answer.ts";
import { checkFigures, type CheckFact } from "./numbers.ts";
import { toAnswerRow, type AnswerRow } from "./store-answer.ts";

export const MAX_QUESTION_CHARS = 1000;
/** Identical questions within this window get the stored answer back. */
export const CACHE_DAYS = 30;
const PASSAGES_PER_QUESTION = 8;

export interface AskRequest {
  ticker: string;
  question: string;
  fromYear: number;
  toYear: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Checks an untrusted JSON body. */
export function parseAskRequest(body: unknown): Parsed<AskRequest> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Send a JSON object." };
  const b = body as Record<string, unknown>;
  const ticker = typeof b.ticker === "string" ? b.ticker.trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return { ok: false, error: "ticker is missing or invalid." };
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (question === "") return { ok: false, error: "question is missing." };
  if (question.length > MAX_QUESTION_CHARS) return { ok: false, error: `question is longer than ${MAX_QUESTION_CHARS} characters.` };
  const year = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 2000 && v <= 2100 ? v : undefined);
  const fromYear = year(b.fromYear);
  const toYear = year(b.toYear);
  if (fromYear === undefined || toYear === undefined || fromYear > toYear) {
    return { ok: false, error: "fromYear and toYear must be years with fromYear ≤ toYear." };
  }
  return { ok: true, value: { ticker, question, fromYear, toYear } };
}

/** Same question despite case and spacing: "  Why did  margin fall? " = "why did margin fall?". */
export function normalizeQuestion(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface AskSource {
  /** Citation number shown in the answer, 1 = first cited. */
  n: number;
  passageId: number;
  fiscalYear: number;
  item: string;
  heading: string | null;
  pageStart: number;
  pageEnd: number;
  citedText: string;
}

export interface AskResponse {
  answerId: number;
  /** True when a stored answer to the same question was reused (no AI call). */
  cached: boolean;
  status: AnswerRow["status"];
  model: string;
  /** The answer in order; `sources` lists which numbered sources back each part. */
  segments: { text: string; sources: number[] }[];
  sources: AskSource[];
  numbers: AnswerRow["numbers_checked"];
}

/** Builds the response from a stored (or just-saved) row, so new and reused answers look the same. */
export function toAskResponse(answerId: number, row: AnswerRow, cached: boolean): AskResponse {
  const n = new Map(row.citations.map((c, i) => [c.passageId, i + 1]));
  return {
    answerId,
    cached,
    status: row.status,
    model: row.model,
    segments: row.segments.map((s) => ({
      text: s.text,
      sources: [...new Set(s.citations.map((c) => n.get(c.passageId)).filter((x): x is number => x !== undefined))],
    })),
    sources: row.citations.map((c, i) => ({ n: i + 1, ...c })),
    numbers: row.numbers_checked,
  };
}

export interface CompanyRef {
  id: number;
  name: string;
  ticker: string;
}

export interface AskDeps {
  /** Model for new answers (Haiku in development, Sonnet deployed). */
  model: string;
  /** New answers allowed per UTC day, across all users. */
  dailyLimit: number;
  /** Return a stored identical answer when there is one (default true; checks and evals turn it off). */
  reuseAnswers?: boolean;
  now: () => Date;
  findCompany: (ticker: string) => Promise<CompanyRef | null>;
  /** Recent answers for this company, years and model, newest first. */
  recentAnswers: (q: { companyId: number; fromYear: number; toYear: number; model: string; since: Date }) => Promise<{ id: number; row: AnswerRow }[]>;
  countAnswersSince: (since: Date) => Promise<number>;
  search: (question: string, options: SearchOptions) => Promise<Passage[]>;
  answer: (question: string, passages: readonly Passage[], ctx: AnswerContext) => Promise<Answer>;
  loadFacts: (companyId: number, fromYear: number, toYear: number) => Promise<CheckFact[]>;
  save: (row: AnswerRow) => Promise<number>;
}

export type AskResult =
  | { ok: true; response: AskResponse }
  | { ok: false; status: 400 | 404 | 429 | 502; error: string };

/** Answers that are worth reusing (not refusals or cut-off replies). */
const REUSABLE = new Set<AnswerRow["status"]>(["answered", "partly_answered", "not_answered"]);

export async function handleAsk(body: unknown, deps: AskDeps): Promise<AskResult> {
  const parsed = parseAskRequest(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { ticker, question, fromYear, toYear } = parsed.value;

  const company = await deps.findCompany(ticker);
  if (!company) return { ok: false, status: 404, error: `${ticker} is not loaded.` };

  const now = deps.now();
  if (deps.reuseAnswers !== false) {
    const since = new Date(now.getTime() - CACHE_DAYS * 24 * 60 * 60 * 1000);
    const recent = await deps.recentAnswers({ companyId: company.id, fromYear, toYear, model: deps.model, since });
    const key = normalizeQuestion(question);
    const hit = recent.find((r) => REUSABLE.has(r.row.status) && normalizeQuestion(r.row.question) === key);
    if (hit) return { ok: true, response: toAskResponse(hit.id, hit.row, true) };
  }

  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if ((await deps.countAnswersSince(midnightUtc)) >= deps.dailyLimit) {
    return { ok: false, status: 429, error: "Today's question limit has been reached. Try again tomorrow." };
  }

  let passages: Passage[];
  let answer: Answer;
  let latencyMs: number;
  try {
    passages = await deps.search(question, {
      companyId: company.id,
      fromYear,
      toYear,
      limit: PASSAGES_PER_QUESTION,
      excludeTerms: companyTerms(company.name, company.ticker),
    });
    const started = performance.now();
    answer = await deps.answer(question, passages, { companyName: company.name, ticker: company.ticker, fromYear, toYear, model: deps.model });
    latencyMs = performance.now() - started;
  } catch (error) {
    // Details go to the server log only; the browser gets a plain message.
    console.error("ask: search or answer failed:", error instanceof Error ? error.message : error);
    return { ok: false, status: 502, error: "The answer service is unavailable right now. Try again in a minute." };
  }

  const facts = await deps.loadFacts(company.id, fromYear, toYear);
  const check = checkFigures(answer.text, facts, passages.map((p) => p.content));
  const row = toAnswerRow({ companyId: company.id, fromYear, toYear, question, answer, passages, check, latencyMs });
  const id = await deps.save(row);
  return { ok: true, response: toAskResponse(id, row, false) };
}

/** Per-visitor limit kept in server memory: at most `max` requests per `windowMs` per key. Rough by design. */
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, nowMs: number): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    hits.set(key, recent);
    // Forget idle visitors so the map can't grow forever.
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((t) => nowMs - t >= windowMs)) hits.delete(k);
    return true;
  };
}
