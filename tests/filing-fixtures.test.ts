import { describe, expect, it } from "vitest";
import { FILING_FIXTURES, loadFilingBytes } from "./filing-fixtures";

describe("10-K fixtures", () => {
  it.each(FILING_FIXTURES)("$ticker FY$fiscalYear unzips into a real inline-XBRL 10-K", ({ ticker, fiscalYear }) => {
    const bytes = loadFilingBytes(ticker, fiscalYear);
    expect(bytes.length).toBeGreaterThan(1_000_000); // 1.4–4.8 MB each
    const text = new TextDecoder().decode(bytes);
    expect(text).toMatch(/<html/i);
    expect(text).toMatch(/ix:header/); // inline XBRL
    expect(text).toMatch(/FORM\s+10-K/i);
    expect(text).toMatch(/Item\s*1A/i);
  });
});
