import { describe, expect, it } from "vitest";
import { companyTerms, keywordText, searchPassages, toPassage, validateSearch, type RpcCall } from "./hybrid.ts";

const options = { companyId: 1, fromYear: 2023, toYear: 2025 };

function fakeDeps(rows: unknown = [], error: { message: string } | null = null) {
  const embedCalls: { texts: readonly string[]; type: string }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: RpcCall = async (name, args) => {
    rpcCalls.push({ name, args });
    return { data: rows, error };
  };
  return {
    embedCalls,
    rpcCalls,
    deps: {
      voyage: {
        async embed(texts: readonly string[], type: "query" | "document") {
          embedCalls.push({ texts, type });
          return { embeddings: [[0.5, 0.25]], tokens: 3 };
        },
      },
      rpc,
    },
  };
}

const row = {
  id: "42",
  filing_id: 7,
  fiscal_year: 2025,
  item: "7",
  heading: "Margin",
  kind: "text",
  page_start: 35,
  page_end: 35,
  content: "Gross profit rate increased 8 basis points.",
  semantic_rank: 1,
  keyword_rank: null,
  score: 0.0164,
};

describe("searchPassages", () => {
  it("embeds the trimmed question as a query and calls search_chunks with the filters", async () => {
    const f = fakeDeps([row]);
    const passages = await searchPassages("  Why did margin change?  ", { ...options, limit: 5, items: ["7"] }, f.deps);
    expect(f.embedCalls).toEqual([{ texts: ["Why did margin change?"], type: "query" }]);
    expect(f.rpcCalls).toEqual([
      {
        name: "search_chunks",
        args: {
          query_embedding: "[0.5,0.25]",
          query_text: "Why did margin change?",
          p_company_id: 1,
          p_from_year: 2023,
          p_to_year: 2025,
          match_count: 5,
          p_items: ["7"],
        },
      },
    ]);
    expect(passages).toEqual([
      {
        id: 42,
        filingId: 7,
        fiscalYear: 2025,
        item: "7",
        heading: "Margin",
        kind: "text",
        pageStart: 35,
        pageEnd: 35,
        content: "Gross profit rate increased 8 basis points.",
        semanticRank: 1,
        keywordRank: null,
        score: 0.0164,
      },
    ]);
  });

  it("defaults to 8 passages and all items", async () => {
    const f = fakeDeps([]);
    await searchPassages("inventory", options, f.deps);
    expect(f.rpcCalls[0]!.args).toMatchObject({ match_count: 8, p_items: null });
  });

  it("surfaces database errors", async () => {
    const f = fakeDeps(null, { message: "function does not exist" });
    await expect(searchPassages("inventory", options, f.deps)).rejects.toThrow("Search failed: function does not exist");
  });

  it("checks inputs before spending a Voyage request", async () => {
    const f = fakeDeps();
    await expect(searchPassages("   ", options, f.deps)).rejects.toThrow("Question is empty");
    expect(f.embedCalls).toHaveLength(0);
  });
});

describe("companyTerms and keywordText", () => {
  it("lists the name's words and the ticker", () => {
    expect(companyTerms("TARGET CORP", "TGT")).toEqual(["target", "corp", "tgt"]);
    expect(companyTerms("COSTCO WHOLESALE CORP /NEW", "COST")).toEqual(["costco", "wholesale", "corp", "new", "cost"]);
  });
  it("removes those words and their possessives, case-insensitively, and nothing else", () => {
    const terms = companyTerms("Walmart Inc.", "WMT");
    expect(keywordText("Why did Walmart's gross profit rate change at WALMART?", terms)).toBe("Why did gross profit rate change at ?");
    expect(keywordText("Inventory at Walmartian stores", terms)).toBe("Inventory at Walmartian stores");
    expect(keywordText("No terms", [])).toBe("No terms");
  });
});

describe("validateSearch", () => {
  it("rejects bad options", () => {
    expect(() => validateSearch("x".repeat(1001), options)).toThrow("longer than 1000");
    expect(() => validateSearch("q", { ...options, fromYear: 2026 })).toThrow("Invalid year range");
    expect(() => validateSearch("q", { ...options, companyId: 0 })).toThrow("Invalid company id");
    expect(() => validateSearch("q", { ...options, limit: 51 })).toThrow("limit must be 1–50");
    expect(validateSearch(" q ", options)).toBe("q");
  });
});

describe("toPassage", () => {
  it("rejects malformed rows and maps table passages", () => {
    expect(() => toPassage(null)).toThrow("non-object");
    expect(() => toPassage({ id: 1 })).toThrow("without id, item or content");
    expect(toPassage({ ...row, kind: "table", heading: null, keyword_rank: 3 })).toMatchObject({
      kind: "table",
      heading: null,
      keywordRank: 3,
    });
  });
});
