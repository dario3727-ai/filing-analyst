import { describe, expect, it } from "vitest";
import { findCompany, parseCompanyTickers } from "@/lib/sec/tickers";
import { submissionsPageUrl } from "@/lib/sec/urls";

// Same shape as https://www.sec.gov/files/company_tickers.json
const SAMPLE = {
  "0": { cik_str: 104169, ticker: "WMT", title: "Walmart Inc." },
  "1": { cik_str: 909832, ticker: "COST", title: "COSTCO WHOLESALE CORP /NEW" },
  "2": { cik_str: "796343", ticker: "adbe", title: "ADOBE INC." },
  "3": { ticker: "BROKEN" }, // malformed: skipped
};

describe("parseCompanyTickers / findCompany", () => {
  const byTicker = parseCompanyTickers(SAMPLE);

  it("finds a company and pads its CIK", () => {
    expect(findCompany(byTicker, "WMT")).toEqual({ cik: "0000104169", ticker: "WMT", title: "Walmart Inc." });
  });

  it("is case-insensitive and trims spaces", () => {
    expect(findCompany(byTicker, " adbe ").cik).toBe("0000796343");
  });

  it("skips malformed rows", () => {
    expect(byTicker.has("BROKEN")).toBe(false);
    expect(byTicker.size).toBe(3);
  });

  it("explains an unknown ticker", () => {
    expect(() => findCompany(byTicker, "NOPE")).toThrow(/"NOPE" not found/);
  });

  it("rejects data with no usable entries", () => {
    expect(() => parseCompanyTickers({})).toThrow(/no usable entries/);
    expect(() => parseCompanyTickers([])).toThrow(/expected a JSON object/);
  });
});

describe("submissionsPageUrl", () => {
  it("builds the URL for an older submissions page", () => {
    expect(submissionsPageUrl("CIK0000104169-submissions-001.json")).toBe(
      "https://data.sec.gov/submissions/CIK0000104169-submissions-001.json",
    );
  });
  it.each(["../x.json", "CIK104169-submissions-001.json", "anything.json"])("rejects %j", (bad) => {
    expect(() => submissionsPageUrl(bad)).toThrow(/Invalid submissions page/);
  });
});
