/**
 * A CIK (Central Index Key) is the SEC's ID number for a company.
 * SEC data URLs need it as exactly 10 digits, padded with leading zeros:
 * Walmart's CIK 104169 becomes "0000104169" in
 * https://data.sec.gov/submissions/CIK0000104169.json
 */

const CIK_DIGITS = 10;

/** Turns a CIK like 104169 or "104169" into the 10-digit form "0000104169". */
export function padCik(cik: string | number): string {
  const text = String(cik).trim();

  // Only plain digits are allowed: no minus sign, decimal point or letters.
  if (!/^\d+$/.test(text)) {
    throw new Error(`Invalid CIK "${cik}": must contain only digits`);
  }
  if (text.length > CIK_DIGITS) {
    throw new Error(`Invalid CIK "${cik}": longer than ${CIK_DIGITS} digits`);
  }
  if (Number(text) === 0) {
    throw new Error(`Invalid CIK "${cik}": must be greater than zero`);
  }

  return text.padStart(CIK_DIGITS, "0");
}
