import { describe, expect, it } from "vitest";
import { companyFactsUrl, filingDocumentUrl, isSecUrl, submissionsUrl } from "@/lib/sec/urls";

describe("SEC URL builders", () => {
  it("builds the submissions URL with a 10-digit CIK", () => {
    expect(submissionsUrl(104169)).toBe("https://data.sec.gov/submissions/CIK0000104169.json");
  });

  it("builds the company facts URL with a 10-digit CIK", () => {
    expect(companyFactsUrl("796343")).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000796343.json");
  });

  it("builds a filing document URL: CIK without zeros, accession without dashes", () => {
    expect(filingDocumentUrl("0000104169", "0000104169-26-000010", "wmt-20260131.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/104169/000010416926000010/wmt-20260131.htm",
    );
  });

  it("accepts an accession number already without dashes", () => {
    expect(filingDocumentUrl(104169, "000010416926000010", "wmt-20260131.htm")).toContain("/000010416926000010/");
  });

  it.each(["", "12-34", "0000104169-26-00001x"])("rejects accession number %j", (bad) => {
    expect(() => filingDocumentUrl(104169, bad, "a.htm")).toThrow(/accession/);
  });

  it.each(["", "../secret.htm", "a/b.htm", "a\\b.htm"])("rejects document name %j", (bad) => {
    expect(() => filingDocumentUrl(104169, "0000104169-26-000010", bad)).toThrow(/document/);
  });
});

describe("isSecUrl", () => {
  it.each([
    ["https://data.sec.gov/submissions/CIK0000104169.json", true],
    ["https://www.sec.gov/Archives/edgar/data/104169/x/y.htm", true],
    ["http://data.sec.gov/submissions/x.json", false], // not https
    ["https://example.com/data.sec.gov", false],
    ["https://data.sec.gov.evil.com/x", false], // look-alike host
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isSecUrl(url)).toBe(expected);
  });
});
