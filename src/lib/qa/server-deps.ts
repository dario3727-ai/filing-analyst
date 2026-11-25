/**
 * Real services for the Ask pipeline, shared by POST /api/ask and the
 * milestone check script so both run exactly the same code. Server and
 * scripts only: uses the secret Supabase key and the Anthropic and Voyage keys.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { createNextTablesLookup } from "../search/next-tables.ts";
import { retrievePassages } from "../search/retrieve.ts";
import { createVoyageClientFromEnv } from "../voyage/client.ts";
import { answerQuestion, DEV_MODEL, QA_MODEL } from "./answer.ts";
import type { AskDeps } from "./ask.ts";
import { loadFactsForCheck } from "./load-facts.ts";
import { saveAnswer, type AnswerRow } from "./store-answer.ts";

export const DEFAULT_DAILY_LIMIT = 50;

type Env = Record<string, string | undefined>;

/** Haiku while developing, Sonnet when deployed (CLAUDE.md); ASK_MODEL=haiku|sonnet overrides. */
export function chooseModel(env: Env): string {
  const override = env.ASK_MODEL?.trim().toLowerCase();
  if (override === "haiku") return DEV_MODEL;
  if (override === "sonnet") return QA_MODEL;
  return env.NODE_ENV === "production" ? QA_MODEL : DEV_MODEL;
}

/** Columns read back for reusing an answer; must match AnswerRow. */
const ANSWER_COLUMNS =
  "id, company_id, from_year, to_year, question, status, answer, segments, citations, passages_sent, numbers_checked, model, stop_reason, input_tokens, output_tokens, latency_ms";

export type DepsResult = { ok: true; deps: AskDeps } | { ok: false; missing: string[] };

/** Builds the real dependencies, or lists which environment variables are missing (names only). */
export function createAskDepsFromEnv(
  env: Env,
  options: { model?: string; voyageMaxRequests?: number; reuseAnswers?: boolean } = {},
): DepsResult {
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY"].filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length > 0) return { ok: false, missing };

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // Capped per set of deps: one question needs one embedding.
  const voyage = createVoyageClientFromEnv(env, { maxRequests: options.voyageMaxRequests ?? 3 })!;
  const limit = Number(env.ASK_DAILY_LIMIT);

  const deps: AskDeps = {
    model: options.model ?? chooseModel(env),
    reuseAnswers: options.reuseAnswers ?? true,
    dailyLimit: limit > 0 ? limit : DEFAULT_DAILY_LIMIT,
    now: () => new Date(),
    async findCompany(ticker) {
      const { data, error } = await db.from("companies").select("id, name, ticker, sector_profile").eq("ticker", ticker).maybeSingle();
      if (error) throw new Error(`Reading company failed: ${error.message}`);
      return data ? { id: Number(data.id), name: String(data.name), ticker: String(data.ticker), sectorProfile: String(data.sector_profile) } : null;
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
      const { count, error } = await db.from("answers").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString());
      if (error) throw new Error(`Counting answers failed: ${error.message}`);
      return count ?? 0;
    },
    search: (question, opts) =>
      retrievePassages(question, opts, {
        voyage,
        rpc: async (name, args) => db.rpc(name, args),
        nextTables: createNextTablesLookup(db),
      }),
    answer: (question, passages, ctx) =>
      answerQuestion(question, passages, ctx, { createMessage: (params) => anthropic.beta.messages.create(params) }),
    loadFacts: (companyId, fromYear, toYear) => loadFactsForCheck(db, companyId, fromYear, toYear),
    save: (row) => saveAnswer(db, row),
  };
  return { ok: true, deps };
}
