/**
 * Claude explains each risk change (decisions 2026-11-25): a structured
 * {summary, materiality} per change, sent through the Message Batches API
 * (half price, asynchronous; CLAUDE.md: bulk jobs use Haiku and batches).
 * Requests and replies are pure functions; `runBatch` submits, waits with a
 * hard cap on polls, and collects results.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { edits } from "./diff.ts";
import type { Materiality, RiskChangeRow } from "./changes.ts";

type Params = Anthropic.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Messages.Message;

/** At most this many edits listed per request (the full new text is included too). */
export const MAX_EDITS_LISTED = 60;
export const MAX_BATCH_REQUESTS = 1000;

export const SUMMARY_SYSTEM = `You explain changes in a company's 10-K Risk Factors between two fiscal years, for an investment analyst.

- Use only the text provided. Do not add outside knowledge or speculate about causes the text doesn't state.
- summary: one or two plain-English sentences on what changed and why it matters to an investor.
- materiality:
  - "high": a new risk; a removed risk of substance; or wording showing a risk has materialized or grown (for example "could affect" became "has affected", or a new specific exposure, event or amount).
  - "medium": meaningful new detail, scope, examples or emphasis that doesn't change the risk's substance.
  - "low": editorial, clarifying or reorganized wording.`;

export const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    materiality: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["summary", "materiality"],
  additionalProperties: false,
} as const;

/** The user message describing one change. */
export function describeChange(row: RiskChangeRow, companyName: string): string {
  const head = `Company: ${companyName}. Comparing the fiscal ${row.from_year} and fiscal ${row.to_year} 10-K Risk Factors.`;
  if (row.kind === "added") {
    return `${head}\n\nThis risk is NEW in fiscal ${row.to_year} (no matching risk in fiscal ${row.from_year}).\n\nTitle: ${row.new_title}\n\nText:\n${row.new_text}`;
  }
  if (row.kind === "removed") {
    return `${head}\n\nThis risk was REMOVED in fiscal ${row.to_year} (it appeared in fiscal ${row.from_year}).\n\nTitle: ${row.old_title}\n\nText:\n${row.old_text}`;
  }
  const changes = edits(row.diff);
  const listed = changes
    .slice(0, MAX_EDITS_LISTED)
    .map((e, i) => `${i + 1}. "${e.before || "(nothing)"}" → "${e.after || "(nothing)"}"`)
    .join("\n");
  const more = changes.length > MAX_EDITS_LISTED ? `\n…and ${changes.length - MAX_EDITS_LISTED} more edits.` : "";
  const title = row.old_title === row.new_title ? `Title: ${row.new_title}` : `Old title: ${row.old_title}\nNew title: ${row.new_title}`;
  return `${head}\n\nThis risk was REWORDED (${row.words_added} words added, ${row.words_removed} removed).\n\n${title}\n\nEdits, old → new:\n${listed}${more}\n\nFiscal ${row.to_year} full text:\n${row.new_text}`;
}

export function summaryRequest(row: RiskChangeRow, companyName: string, model: string): Params {
  return {
    model,
    max_tokens: 2000,
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: describeChange(row, companyName) }],
    output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
  };
}

/** The structured reply, or null when it's missing, refused or malformed. */
export function parseSummary(message: Pick<Message, "content" | "stop_reason">): { summary: string; materiality: Materiality } | null {
  if (message.stop_reason !== "end_turn") return null;
  const text = message.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text;
  if (!text) return null;
  try {
    const value = JSON.parse(text) as { summary?: unknown; materiality?: unknown };
    if (typeof value.summary !== "string" || value.summary.trim() === "") return null;
    if (value.materiality !== "high" && value.materiality !== "medium" && value.materiality !== "low") return null;
    return { summary: value.summary.trim(), materiality: value.materiality };
  } catch {
    return null;
  }
}

/** The part of the SDK's batches API this module uses, so tests can pass a fake. */
export interface BatchApi {
  create(body: { requests: { custom_id: string; params: Params }[] }): Promise<{ id: string }>;
  retrieve(id: string): Promise<{ processing_status: string; request_counts: { processing: number; succeeded: number; errored: number } }>;
  results(id: string): Promise<AsyncIterable<{ custom_id: string; result: { type: string; message?: Message } }>>;
}

export interface BatchOptions {
  pollMs?: number;
  /** Hard cap on status checks (CLAUDE.md: no uncapped API loops). Default 240 (an hour at 15 s). */
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  onPoll?: (status: { processing: number; succeeded: number; errored: number }) => void;
}

/** Submits the requests as one batch, waits until it ends, and returns each succeeded message by custom_id. */
export async function runBatch(api: BatchApi, requests: { custom_id: string; params: Params }[], options: BatchOptions = {}): Promise<Map<string, Message>> {
  if (requests.length === 0) return new Map();
  if (requests.length > MAX_BATCH_REQUESTS) throw new Error(`More than ${MAX_BATCH_REQUESTS} requests in one batch; raise the cap deliberately.`);
  const pollMs = options.pollMs ?? 15_000;
  const maxPolls = options.maxPolls ?? 240;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const batch = await api.create({ requests });
  for (let poll = 0; ; poll++) {
    const status = await api.retrieve(batch.id);
    options.onPoll?.(status.request_counts);
    if (status.processing_status === "ended") break;
    if (poll + 1 >= maxPolls) {
      throw new Error(`Batch ${batch.id} still running after ${maxPolls} checks; its results stay available for 29 days.`);
    }
    await sleep(pollMs);
  }
  const messages = new Map<string, Message>();
  for await (const r of await api.results(batch.id)) {
    if (r.result.type === "succeeded" && r.result.message) messages.set(r.custom_id, r.result.message);
  }
  return messages;
}
