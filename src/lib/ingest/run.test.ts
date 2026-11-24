import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runIngest } from "@/lib/ingest/run";
import { sectorProfileForSic } from "@/lib/ingest/sector";
import { createSecClient } from "@/lib/sec/client";
import { createFakeClock } from "../../../tests/fake-clock";
import { createFakeStore } from "../../../tests/fake-store";

const fixtureText = (name: string) =>
  readFileSync(new URL(`../../../tests/fixtures/sec/${name}`, import.meta.url), "utf8");

const TICKERS = JSON.stringify({
  "0": { cik_str: 104169, ticker: "WMT", title: "Walmart Inc." },
  "1": { cik_str: 909832, ticker: "COST", title: "COSTCO WHOLESALE CORP /NEW" },
});

/** Fake SEC: answers by URL; anything unexpected is a 404. Records every URL asked for. */
function fakeSec(routes: Record<string, string>) {
  const asked: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    asked.push(url);
    const body = routes[url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  };
  const sec = createSecClient({ userAgent: "Test test@example.org", fetchFn, clock: createFakeClock() });
  return { sec, asked };
}

const WMT_ROUTES = {
  "https://www.sec.gov/files/company_tickers.json": TICKERS,
  "https://data.sec.gov/submissions/CIK0000104169.json": fixtureText("submissions-wmt.json"),
};

describe("runIngest: submissions step on real Walmart data", () => {
  it("stores the company and its 10-Ks for the window, and logs a successful run", async () => {
    const { sec } = fakeSec(WMT_ROUTES);
    const store = createFakeStore();
    const result = await runIngest({ ticker: "WMT", fromYear: 2023, toYear: 2025 }, { sec, store, now: () => "T" });

    expect(store.companies.get("0000104169")).toMatchObject({
      ticker: "WMT",
      name: "Walmart Inc.",
      sic_code: "5331",
      sector_profile: "retail",
      fiscal_year_end: "01-31",
    });
    expect([...store.filings.values()].map((f) => [f.fiscal_year, f.period_end])).toEqual([
      [2023, "2024-01-31"],
      [2024, "2025-01-31"],
      [2025, "2026-01-31"],
    ]);
    expect(store.runs.get(result.runId)).toMatchObject({
      ticker: "WMT",
      params: { from: 2023, to: 2025 },
      status: "success",
      step: "submissions",
      company_id: result.submissions.companyId,
      counts: { filings: 3, older_pages: 0, sec_requests: 2 },
      finished_at: "T",
    });
  });

  it("is safe to run twice: same rows, same company id", async () => {
    const store = createFakeStore();
    const first = await runIngest({ ticker: "WMT", fromYear: 2023, toYear: 2025 }, { ...fakeSec(WMT_ROUTES), store });
    const second = await runIngest({ ticker: "WMT", fromYear: 2023, toYear: 2025 }, { ...fakeSec(WMT_ROUTES), store });
    expect(second.submissions.companyId).toBe(first.submissions.companyId);
    expect(store.companies.size).toBe(1);
    expect(store.filings.size).toBe(3);
    expect(store.runs.size).toBe(2); // each run is logged
  });

  it("fetches Walmart's older filing page when the window starts before 2023", async () => {
    // The real older page isn't saved as a fixture, so serve a minimal one with one 10-K.
    const olderPage = JSON.stringify({
      accessionNumber: ["0000104169-22-000012"],
      filingDate: ["2022-03-18"],
      reportDate: ["2022-01-31"],
      form: ["10-K"],
      primaryDocument: ["wmt-20220131.htm"],
      isInlineXBRL: [1],
    });
    const { sec, asked } = fakeSec({
      ...WMT_ROUTES,
      "https://data.sec.gov/submissions/CIK0000104169-submissions-001.json": olderPage,
    });
    const store = createFakeStore();
    const result = await runIngest({ ticker: "WMT", fromYear: 2021, toYear: 2023 }, { sec, store });

    expect(asked).toContain("https://data.sec.gov/submissions/CIK0000104169-submissions-001.json");
    expect(result.submissions.tenKs.map((t) => t.fiscalYear)).toEqual([2021, 2023]);
    expect(result.submissions.warnings).toEqual(["No 10-K found for fiscal year(s) 2022"]);
  });

  it("logs a failed run with the error, then rethrows", async () => {
    const { sec } = fakeSec(WMT_ROUTES);
    const store = createFakeStore();
    await expect(runIngest({ ticker: "NOPE", fromYear: 2023, toYear: 2025 }, { sec, store, now: () => "T" })).rejects.toThrow(
      /"NOPE" not found/,
    );
    const run = store.runs.get(1);
    expect(run).toMatchObject({ ticker: "NOPE", status: "failed", finished_at: "T" });
    expect(run?.error).toMatch(/"NOPE" not found/);
    expect(store.companies.size).toBe(0);
  });
});

describe("sectorProfileForSic", () => {
  it.each([
    ["5331", "retail"], // Walmart, Target, Costco, Five Below
    ["5411", "retail"], // Kroger
    ["5651", "retail"], // Gap
    ["7372", "unprofiled"], // Adobe
    ["5199", "unprofiled"], // wholesale, not retail
    [null, "unprofiled"],
    ["abc", "unprofiled"],
  ])("%s → %s", (sic, expected) => {
    expect(sectorProfileForSic(sic)).toBe(expected);
  });
});
