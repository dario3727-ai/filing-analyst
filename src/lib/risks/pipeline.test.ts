import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildChangeRows, changeKey, needsSummary, NUMBERS_ONLY_SUMMARY, type RiskChangeRow } from "./changes.ts";
import { consecutivePairs, runRiskPipeline, type RiskPipelineDeps } from "./pipeline.ts";
import type { Risk } from "./split.ts";
import { describeChange, parseSummary, runBatch, summaryRequest, type BatchApi } from "./summarize.ts";

type Message = Anthropic.Messages.Message;
const risk = (index: number, title: string, body: string): Risk => ({ index, title, body, category: "Strategic Risks", page: 10 + index });

const y2024 = [
  risk(0, "We face strong competition.", "Competition is intense."),
  risk(1, "Tariffs could increase our costs.", "Tariffs could require us to raise prices on imported merchandise."),
  risk(2, "The COVID-19 pandemic could disrupt operations.", "Stores may close."),
  risk(3, "Our debt agreements restrict us.", "See Note 20 for fiscal 2024 details."),
];
const y2025 = [
  risk(0, "We face strong competition.", "Competition is intense."),
  risk(1, "Tariffs could increase our costs.", "Tariffs have required us to raise prices on imported merchandise."),
  risk(2, "AI shopping agents could reduce our traffic.", "Shoppers use AI agents to compare prices."),
  risk(3, "Our debt agreements restrict us.", "See Note 22 for fiscal 2025 details."),
];

/** A minimal structured reply; only the fields the code reads. */
const reply = (json: unknown, stop_reason = "end_turn"): Message =>
  ({ model: "claude-haiku-5-5", stop_reason, content: [{ type: "text", text: JSON.stringify(json) }] }) as unknown as Message;

describe("buildChangeRows", () => {
  const rows = buildChangeRows(7, 2024, 2025, y2024, y2025);
  it("records each risk's kind, both versions and the word changes", () => {
    expect(rows.map((r) => [r.position, r.kind, r.old_title?.slice(0, 12) ?? null, r.new_title?.slice(0, 12) ?? null])).toEqual([
      [0, "unchanged", "We face stro", "We face stro"],
      [1, "modified", "Tariffs coul", "Tariffs coul"],
      [2, "removed", "The COVID-19", null],
      [3, "added", null, "AI shopping "],
      [4, "modified", "Our debt agr", "Our debt agr"],
    ]);
    expect(rows[1]).toMatchObject({ words_added: 2, words_removed: 2, numbers_only: false, summary: null, company_id: 7 });
    expect(rows[0]!.diff).toEqual([]);
  });
  it("gives numbers-only changes a fixed summary instead of an AI call", () => {
    expect(rows[4]).toMatchObject({ numbers_only: true, summary: NUMBERS_ONLY_SUMMARY, materiality: "low" });
    expect(rows.map(needsSummary)).toEqual([false, true, true, true, false]);
  });
  it("fingerprints a change by its kind and text", () => {
    expect(changeKey("modified", "a", "b")).toBe(changeKey("modified", "a", "b"));
    expect(changeKey("modified", "a", "b")).not.toBe(changeKey("modified", "a", "c"));
  });
});

describe("summary requests and replies", () => {
  const rows = buildChangeRows(7, 2024, 2025, y2024, y2025);
  it("describes each kind of change and asks for the JSON schema", () => {
    expect(describeChange(rows[1]!, "Walmart Inc.")).toContain('"could require" → "have required"');
    expect(describeChange(rows[2]!, "Walmart Inc.")).toContain("REMOVED in fiscal 2025");
    expect(describeChange(rows[3]!, "Walmart Inc.")).toContain("NEW in fiscal 2025");
    const req = summaryRequest(rows[1]!, "Walmart Inc.", "claude-haiku-5-5");
    expect(req).toMatchObject({ model: "claude-haiku-5-5", output_config: { format: { type: "json_schema" } } });
    expect(req.system).toContain("Use only the text provided");
  });
  it("accepts a valid reply and rejects refusals, cut-offs and bad JSON", () => {
    expect(parseSummary(reply({ summary: " Tariffs have now raised prices. ", materiality: "high" }))).toEqual({
      summary: "Tariffs have now raised prices.",
      materiality: "high",
    });
    expect(parseSummary(reply({ summary: "x", materiality: "high" }, "refusal"))).toBeNull();
    expect(parseSummary(reply({ summary: "x", materiality: "severe" }))).toBeNull();
    expect(parseSummary({ stop_reason: "end_turn", content: [{ type: "text", text: "not json", citations: null }] } as unknown as Message)).toBeNull();
  });
});

describe("runBatch", () => {
  function fakeApi(statuses: string[], results: { custom_id: string; result: { type: string; message?: Message } }[]) {
    const calls: string[] = [];
    const api: BatchApi = {
      create: async (body) => (calls.push(`create:${body.requests.length}`), { id: "batch_1" }),
      retrieve: async () => (calls.push("retrieve"), { processing_status: statuses.shift() ?? "ended", request_counts: { processing: 0, succeeded: 1, errored: 0 } }),
      results: async () => {
        calls.push("results");
        return (async function* () {
          yield* results;
        })();
      },
    };
    return { api, calls };
  }
  const req = { custom_id: "r0", params: { model: "m", max_tokens: 10, messages: [] } };

  it("submits once, polls until ended, and keeps only succeeded results", async () => {
    const f = fakeApi(["in_progress", "in_progress", "ended"], [
      { custom_id: "r0", result: { type: "succeeded", message: reply({ summary: "s", materiality: "low" }) } },
      { custom_id: "r1", result: { type: "errored" } },
    ]);
    const sleeps: number[] = [];
    const out = await runBatch(f.api, [req], { pollMs: 5, sleep: async (ms) => void sleeps.push(ms) });
    expect(f.calls).toEqual(["create:1", "retrieve", "retrieve", "retrieve", "results"]);
    expect(sleeps).toEqual([5, 5]);
    expect([...out.keys()]).toEqual(["r0"]);
  });
  it("stops at the poll cap instead of waiting forever", async () => {
    const f = fakeApi(["in_progress", "in_progress", "in_progress"], []);
    await expect(runBatch(f.api, [req], { maxPolls: 2, sleep: async () => undefined })).rejects.toThrow("still running after 2 checks");
  });
  it("sends nothing for an empty list", async () => {
    const f = fakeApi([], []);
    expect((await runBatch(f.api, [])).size).toBe(0);
    expect(f.calls).toEqual([]);
  });
});

describe("runRiskPipeline", () => {
  it("compares consecutive years, reuses stored summaries, batches the rest, and replaces each pair's rows", async () => {
    const saved: { pair: string; rows: readonly RiskChangeRow[] }[] = [];
    const sent: string[][] = [];
    const firstRows = buildChangeRows(1, 2024, 2025, y2024, y2025);
    const tariffKey = firstRows[1]!.change_key;
    const deps: RiskPipelineDeps = {
      model: "claude-haiku-5-5",
      loadRisks: async (_t, year) => (year === 2024 ? y2024 : y2025),
      storedSummaries: async () => new Map([[tariffKey, { summary: "Stored before.", materiality: "high", model: "claude-haiku-5-5" }]]),
      runBatch: async (requests) => {
        sent.push(requests.map((r) => r.custom_id));
        return new Map([
          ["r0", reply({ summary: "COVID risk dropped.", materiality: "medium" })],
          // r1 (the added risk) fails: stored without a summary for the next run.
        ]);
      },
      replaceRows: async (_c, from, to, rows) => (saved.push({ pair: `${from}-${to}`, rows }), rows.length),
    };
    const result = await runRiskPipeline([{ id: 1, name: "Walmart Inc.", ticker: "WMT", years: [2025, 2024, 2022] }], deps);

    // 2022 has no 2023 neighbor, so only 2024→2025 is compared.
    expect(saved.map((s) => s.pair)).toEqual(["2024-2025"]);
    expect(sent).toEqual([["r0", "r1"]]);
    expect(result).toMatchObject({ summarized: 1, reused: 1, failed: 1, rows: 5 });
    const rows = saved[0]!.rows;
    expect(rows[1]).toMatchObject({ summary: "Stored before.", materiality: "high" });
    expect(rows[2]).toMatchObject({ kind: "removed", summary: "COVID risk dropped.", model: "claude-haiku-5-5" });
    expect(rows[3]).toMatchObject({ kind: "added", summary: null });
    expect(result.pairs[0]!.counts).toEqual({ unchanged: 1, modified: 2, removed: 1, added: 1 });
  });
});

describe("consecutivePairs", () => {
  it("pairs neighboring years only", () => {
    expect(consecutivePairs([2025, 2023, 2024, 2021])).toEqual([
      [2023, 2024],
      [2024, 2025],
    ]);
    expect(consecutivePairs([2025])).toEqual([]);
  });
});
