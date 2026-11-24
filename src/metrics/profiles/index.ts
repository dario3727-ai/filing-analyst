/**
 * All sector profiles by id. v1 only fills in retail. Companies whose
 * `sector_profile` has no entry here (e.g. "unprofiled" for the Adobe crash
 * test) get undefined; the ratio engine decides how to treat them.
 */
import type { SectorProfile } from "../types.ts";
import { retailProfile } from "./retail.ts";

const PROFILES: ReadonlyMap<string, SectorProfile> = new Map([[retailProfile.id, retailProfile]]);

export function getProfile(id: string): SectorProfile | undefined {
  return PROFILES.get(id);
}

export const allProfiles: readonly SectorProfile[] = [...PROFILES.values()];
