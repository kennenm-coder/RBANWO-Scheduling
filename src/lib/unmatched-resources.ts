import { Crew, RForceOrder, TimeOffRequest } from "./types";

function normalizeForMatch(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function fuzzyMatch(a: string, b: string): boolean {
  const aNorm = normalizeForMatch(a);
  const bNorm = normalizeForMatch(b);
  if (aNorm === bNorm) return true;
  const aParts = aNorm.split(" ");
  const bParts = bNorm.split(" ");
  if (aParts.length < 2 || bParts.length < 2) return aNorm === bNorm;
  const aFirst = aParts[0];
  const aLast = aParts[aParts.length - 1];
  const bFirst = bParts[0];
  const bLast = bParts[bParts.length - 1];
  return aFirst === bFirst && aLast.slice(0, 4) === bLast.slice(0, 4);
}

function matchesCrew(name: string, crews: Crew[]): boolean {
  for (const crew of crews) {
    if (fuzzyMatch(name, crew.name)) return true;
    if (crew.aliases) {
      for (const alias of crew.aliases) {
        if (fuzzyMatch(name, alias)) return true;
      }
    }
  }
  return false;
}

export interface UnmatchedName {
  name: string;
  source: "rforce" | "timeoff";
}

export function findUnmatchedNames(
  crews: Crew[],
  rforceOrders: RForceOrder[],
  timeOffRequests: TimeOffRequest[]
): UnmatchedName[] {
  const seen = new Set<string>();
  const unmatched: UnmatchedName[] = [];

  for (const rf of rforceOrders) {
    const names = [
      rf.primary_resource,
      rf.tech_measure_name,
      rf.installer,
      rf.service_rep,
    ].filter(Boolean) as string[];
    for (const name of names) {
      const key = normalizeForMatch(name);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!matchesCrew(name, crews)) {
        unmatched.push({ name, source: "rforce" });
      }
    }
  }

  for (const tor of timeOffRequests) {
    const key = normalizeForMatch(tor.employee_name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!matchesCrew(tor.employee_name, crews)) {
      unmatched.push({ name: tor.employee_name, source: "timeoff" });
    }
  }

  return unmatched;
}
