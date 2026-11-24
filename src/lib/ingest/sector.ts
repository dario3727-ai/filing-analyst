/**
 * Which sector profile a company uses, from its SEC industry (SIC) code.
 * SIC 5200–5999 is retail trade. v1 only has a retail profile; anything else
 * (like the Adobe crash test, SIC 7372) is "unprofiled", and the ratio engine
 * must handle that without crashing. Revisit when the profile task decides
 * exactly how unprofiled companies are treated.
 */
export type SectorProfile = "retail" | "unprofiled";

export function sectorProfileForSic(sic: string | null): SectorProfile {
  if (sic === null || !/^\d{4}$/.test(sic)) return "unprofiled";
  const code = Number(sic);
  return code >= 5200 && code <= 5999 ? "retail" : "unprofiled";
}
