import { describe, expect, it } from "vitest";
import type { Passage, RpcCall } from "./hybrid.ts";
import { insertTables, interleaveByYear, retrievePassages, slotsFor } from "./retrieve.ts";

const p = (id: number, fiscalYear = 2025, kind: "text" | "table" = "text"): Passage => ({
  id,
  filingId: fiscalYear,
  fiscalYear,
  item: "7",
  heading: null,
  kind,
  pageStart: 1,
  pageEnd: 1,
  content: `passage ${id}`,
  semanticRank: id,
  keywordRank: null,
  score: 1 / id,
});
const ids = (ps: readonly Passage[]) => ps.map((x) => x.id);

describe("interleaveByYear", () => {
  it("lets years take turns so one year can't crowd out another (the Target case)", () => {
    // Ranked list: seven fiscal 2024 passages ahead of the fiscal 2025 ones.
    const ranked = [p(1, 2024), p(2, 2024), p(3, 2024), p(4, 2024), p(5, 2024), p(6, 2024), p(7, 2024), p(8, 2025), p(9, 2024), p(16, 2025), p(17, 2025)];
    expect(ids(interleaveByYear(ranked, 8))).toEqual([1, 8, 2, 16, 3, 17, 4, 5]);
  });
  it("keeps rank order within a year and stops when candidates run out", () => {
    expect(ids(interleaveByYear([p(1, 2025), p(2, 2025)], 8))).toEqual([1, 2]);
    expect(interleaveByYear([], 8)).toEqual([]);
  });
});

describe("insertTables", () => {
  it("puts a following table right after its lead-in (the Gap case)", () => {
    const tables = new Map([[3149, p(3150, 2025, "table")]]);
    expect(ids(insertTables([p(3068), p(3149), p(3153)], tables))).toEqual([3068, 3149, 3150, 3153]);
  });
  it("doesn't repeat a table that was already chosen, and caps how many are added", () => {
    expect(ids(insertTables([p(1), p(2, 2025, "table")], new Map([[1, p(2, 2025, "table")]])))).toEqual([1, 2]);
    const many = new Map([1, 2, 3].map((n) => [n, p(n + 100, 2025, "table")] as const));
    expect(ids(insertTables([p(1), p(2), p(3)], many, 2))).toEqual([1, 101, 2, 102, 3]);
  });
});

describe("slotsFor", () => {
  it("gives 4 slots per year for multi-year questions, between the limit and 12", () => {
    expect([slotsFor(8, 1), slotsFor(8, 2), slotsFor(8, 3), slotsFor(8, 5)]).toEqual([8, 8, 12, 12]);
  });
});

describe("retrievePassages", () => {
  function deps(rows: Passage[]) {
    const rpcCalls: Record<string, unknown>[] = [];
    const lookups: number[][] = [];
    let embeds = 0;
    const rpc: RpcCall = async (_name, args) => {
      rpcCalls.push(args);
      // Like search_chunks: only that year range, best first, at most match_count. Rows use column names.
      const inRange = rows.filter((r) => r.fiscalYear >= Number(args.p_from_year) && r.fiscalYear <= Number(args.p_to_year));
      const data = inRange.slice(0, Number(args.match_count)).map((r) => ({
        id: r.id,
        filing_id: r.filingId,
        fiscal_year: r.fiscalYear,
        item: r.item,
        heading: r.heading,
        kind: r.kind,
        page_start: r.pageStart,
        page_end: r.pageEnd,
        content: r.content,
        semantic_rank: r.semanticRank,
        keyword_rank: r.keywordRank,
        score: r.score,
      }));
      return { data, error: null };
    };
    return {
      rpcCalls,
      lookups,
      embeds: () => embeds,
      deps: {
        voyage: {
          embed: async () => {
            embeds++;
            return { embeddings: [[0.1]], tokens: 1 };
          },
        },
        rpc,
        nextTables: async (passageIds: readonly number[]) => {
          lookups.push([...passageIds]);
          return new Map([[2, p(50, 2024, "table")]]);
        },
      },
    };
  }

  it("searches each year on its own with one embedding, then takes turns (the Target and Kroger cases)", async () => {
    // Six strong 2024 passages would fill every slot if years were ranked together.
    const rows = [p(1, 2024), p(2, 2024), p(3, 2024), p(4, 2024), p(5, 2024), p(6, 2024), p(30, 2025), p(31, 2025), p(32, 2025)];
    const f = deps(rows);
    const result = await retrievePassages("q", { companyId: 1, fromYear: 2024, toYear: 2025, limit: 8 }, f.deps);
    expect(f.embeds()).toBe(1);
    // Each year ranks 12 candidates (so keyword and meaning lists fuse fully), then keeps its top 4.
    expect(f.rpcCalls.map((a) => [a.p_from_year, a.p_to_year, a.match_count])).toEqual([
      [2024, 2024, 12],
      [2025, 2025, 12],
    ]);
    // 2024: 1–4, 2025: 30–32, alternating; the table after passage 2 follows it.
    expect(ids(result)).toEqual([1, 30, 2, 50, 31, 3, 32, 4]);
  });

  it("keeps plain ranking for a single year", async () => {
    const f = deps([p(1, 2024), p(2, 2024), p(3, 2024)]);
    const result = await retrievePassages("q", { companyId: 1, fromYear: 2024, toYear: 2024, limit: 2 }, f.deps);
    expect(f.rpcCalls).toHaveLength(1);
    expect(f.rpcCalls[0]).toMatchObject({ match_count: 12 });
    expect(ids(result)).toEqual([1, 2, 50]);
  });

  it("leaves the company's name out of the keyword text only", async () => {
    const f = deps([p(1, 2024)]);
    await retrievePassages(
      "How much did Target spend on share repurchases?",
      { companyId: 1, fromYear: 2024, toYear: 2024, excludeTerms: ["target", "corp", "tgt"] },
      f.deps,
    );
    expect(f.rpcCalls[0]).toMatchObject({ query_text: "How much did spend on share repurchases?" });
  });

  it("rejects an empty question before spending a Voyage request", async () => {
    const f = deps([]);
    await expect(retrievePassages(" ", { companyId: 1, fromYear: 2024, toYear: 2025 }, f.deps)).rejects.toThrow("Question is empty");
    expect(f.embeds()).toBe(0);
  });

  it("skips the table lookup when search finds nothing", async () => {
    const f = deps([]);
    expect(await retrievePassages("q", { companyId: 1, fromYear: 2024, toYear: 2025 }, f.deps)).toEqual([]);
    expect(f.lookups).toEqual([]);
  });
});
