/**
 * POST /api/ask  { ticker, question, fromYear, toYear }
 * Runs on the server only, so the secret Supabase key and the Anthropic and
 * Voyage keys never reach the browser. All the logic is in lib/qa/ask.ts;
 * this file connects real clients and turns results into HTTP responses.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { answerQuestion, DEV_MODEL, QA_MODEL } from "@/lib/qa/answer";
import { createRateLimiter, handleAsk, type AskDeps } from "@/lib/qa/ask";
import { loadFactsForCheck } from "@/lib/qa/load-facts";
import { saveAnswer, type AnswerRow } from "@/lib/qa/store-answer";
import { searchPassages } from "@/lib/search/hybrid";
import { createVoyageClientFromEnv } from "@/lib/voyage/client";

/** A Sonnet answer takes ~5–15 s; leave room for a retry. */
export const maxDuration = 60;

/** 5 questions a minute per visitor address (kept in this server's memory, so rough by design). */
const allowVisitor = createRateLimiter(5, 60_000);

/** Haiku while developing, Sonnet when deployed (CLAUDE.md); ASK_MODEL=haiku|sonnet overrides. */
function chooseModel(): string {
  const override = process.env.ASK_MODEL?.trim().toLowerCase();
  if (override === "haiku") return DEV_MODEL;
  if (override === "sonnet") return QA_MODEL;
  return process.env.NODE_ENV === "production" ? QA_MODEL : DEV_MODEL;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Columns read back for reusing an answer; must match AnswerRow. */
const ANSWER_COLUMNS =
  "id, company_id, from_year, to_year, question, status, answer, segments, citations, passages_sent, numbers_checked, model, stop_reason, input_tokens, output_tokens, latency_ms";

function buildDeps(db: SupabaseClient, anthropic: Anthropic): AskDeps | null {
  // A fresh, capped Voyage client per request: one question needs one embedding.
  const voyage = createVoyageClientFromEnv(process.env, { maxRequests: 3 });
  if (!voyage) return null;
  return {
    model: chooseModel(),
    dailyLimit: Number(process.env.ASK_DAILY_LIMIT) > 0 ? Number(process.env.ASK_DAILY_LIMIT) : 50,
    now: () => new Date(),
    async findCompany(ticker) {
      const { data, error } = await db.from("companies").select("id, name, ticker").eq("ticker", ticker).maybeSingle();
      if (error) throw new Error(`Reading company failed: ${error.message}`);
      return data ? { id: Number(data.id), name: String(data.name), ticker: String(data.ticker) } : null;
    },
    async recentAnswers({ companyId, fromYear, toYear, model, since }) {
      const { data, error } = await db
        .from("answers")
        .select(ANSWER_COLUMNS)
        .eq("company_id", companyId)
        .eq("from_year", fromYear)
        .eq("to_year", toYear)
        .eq("model", model)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(`Reading recent answers failed: ${error.message}`);
      // Rows come back untyped from supabase-js; the select above lists AnswerRow's columns.
      return ((data ?? []) as unknown as (AnswerRow & { id: number | string })[]).map(({ id, ...row }) => ({ id: Number(id), row }));
    },
    async countAnswersSince(since) {
      const { count, error } = await db
        .from("answers")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since.toISOString());
      if (error) throw new Error(`Counting answers failed: ${error.message}`);
      return count ?? 0;
    },
    search: (question, options) => searchPassages(question, options, { voyage, rpc: async (name, args) => db.rpc(name, args) }),
    answer: (question, passages, ctx) =>
      answerQuestion(question, passages, ctx, { createMessage: (params) => anthropic.beta.messages.create(params) }),
    loadFacts: (companyId, fromYear, toYear) => loadFactsForCheck(db, companyId, fromYear, toYear),
    save: (row) => saveAnswer(db, row),
  };
}

export async function POST(request: Request): Promise<Response> {
  const visitor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowVisitor(visitor, Date.now())) {
    return json(429, { error: "Too many questions in a minute. Wait a moment and try again." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Send a JSON body." });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey || !process.env.ANTHROPIC_API_KEY) {
    console.error("ask: server is missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY or ANTHROPIC_API_KEY");
    return json(500, { error: "The server isn't configured for questions yet." });
  }
  const db = createClient(url, secretKey, { auth: { persistSession: false } });
  const deps = buildDeps(db, new Anthropic());
  if (!deps) {
    console.error("ask: server is missing VOYAGE_API_KEY");
    return json(500, { error: "The server isn't configured for questions yet." });
  }

  try {
    const result = await handleAsk(body, deps);
    return result.ok ? json(200, result.response) : json(result.status, { error: result.error });
  } catch (error) {
    console.error("ask: unexpected error:", error instanceof Error ? error.message : error);
    return json(500, { error: "Something went wrong answering this question." });
  }
}
