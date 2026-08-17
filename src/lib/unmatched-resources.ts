import { Crew, RForceOrder, TimeOffRequest } from "./types";

export function normalizeForMatch(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Flag-resolution key prefix used to remember that a scheduler explicitly
 * DENIED a close-enough (fuzzy) resource-name suggestion — i.e. "Sam Morman"
 * and "Sam Mormon" are actually different people, don't keep suggesting them.
 * Stored in sched_flag_resolutions so no dedicated table/migration is needed.
 */
export const RESOURCE_DENY_PREFIX = "resource-name-denied:";

export function deniedNameKey(name: string): string {
  return `${RESOURCE_DENY_PREFIX}${normalizeForMatch(name)}`;
}

/** Build the set of normalized names that have been denied, from flag keys. */
export function deniedNamesFromFlagKeys(flagKeys: string[]): Set<string> {
  const set = new Set<string>();
  for (const k of flagKeys) {
    if (k.startsWith(RESOURCE_DENY_PREFIX)) {
      set.add(k.slice(RESOURCE_DENY_PREFIX.length));
    }
  }
  return set;
}

/**
 * Lenient match: same first name AND the last names agree on their first four
 * letters. Tolerates spelling drift like "Morman" vs "Mormon". This is what
 * powers the "close enough — confirm?" suggestions.
 */
export function fuzzyMatch(a: string, b: string): boolean {
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

/** Strict match: normalized name equals the crew's name or one of its aliases. */
export function exactMatchCrew(name: string, crews: Crew[]): Crew | undefined {
  const n = normalizeForMatch(name);
  return crews.find(
    (crew) =>
      normalizeForMatch(crew.name) === n ||
      (crew.aliases || []).some((alias) => normalizeForMatch(alias) === n)
  );
}

/** Lenient match: first crew whose name/alias fuzzy-matches the given name. */
export function fuzzyMatchCrew(name: string, crews: Crew[]): Crew | undefined {
  return crews.find(
    (crew) =>
      fuzzyMatch(name, crew.name) ||
      (crew.aliases || []).some((alias) => fuzzyMatch(name, alias))
  );
}

function matchesCrew(name: string, crews: Crew[]): boolean {
  return !!fuzzyMatchCrew(name, crews);
}

export interface UnmatchedName {
  name: string;
  source: "rforce" | "timeoff";
}

/**
 * A name that fuzzy-matches an existing resource but is NOT an exact
 * name/alias match — a "close enough" suggestion the scheduler should confirm.
 */
export interface SuggestedMatch {
  name: string;
  source: "rforce" | "timeoff";
  crewId: string;
  crewName: string;
}

/** Every distinct resource name that appears in rForce or time-off data. */
function collectNames(
  rforceOrders: RForceOrder[],
  timeOffRequests: TimeOffRequest[]
): { name: string; source: "rforce" | "timeoff" }[] {
  const seen = new Set<string>();
  const out: { name: string; source: "rforce" | "timeoff" }[] = [];
  const push = (raw: string | null | undefined, source: "rforce" | "timeoff") => {
    if (!raw) return;
    const key = normalizeForMatch(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: raw, source });
  };
  for (const rf of rforceOrders) {
    push(rf.primary_resource, "rforce");
    push(rf.tech_measure_name, "rforce");
    push(rf.installer, "rforce");
    push(rf.service_rep, "rforce");
  }
  for (const tor of timeOffRequests) {
    push(tor.employee_name, "timeoff");
  }
  return out;
}

/**
 * Split every rForce/time-off resource name into three buckets:
 *   - exact   → already matches a resource by name/alias (not returned)
 *   - suggested → close-enough fuzzy match, awaiting confirm/deny
 *   - unmatched → no fuzzy match at all, OR previously denied
 *
 * `deniedNames` is the set of normalized names a scheduler has explicitly
 * denied (see RESOURCE_DENY_PREFIX). A denied name is forced into `unmatched`
 * so it follows the manual Alias/Add flow instead of re-suggesting.
 */
export function categorizeResourceNames(
  crews: Crew[],
  rforceOrders: RForceOrder[],
  timeOffRequests: TimeOffRequest[],
  deniedNames: Set<string> = new Set()
): { unmatched: UnmatchedName[]; suggested: SuggestedMatch[] } {
  const unmatched: UnmatchedName[] = [];
  const suggested: SuggestedMatch[] = [];

  for (const { name, source } of collectNames(rforceOrders, timeOffRequests)) {
    if (exactMatchCrew(name, crews)) continue; // already resolved

    if (deniedNames.has(normalizeForMatch(name))) {
      unmatched.push({ name, source });
      continue;
    }

    const fuzzy = fuzzyMatchCrew(name, crews);
    if (fuzzy) {
      suggested.push({ name, source, crewId: fuzzy.id, crewName: fuzzy.name });
    } else {
      unmatched.push({ name, source });
    }
  }

  return { unmatched, suggested };
}

/**
 * Names that match no resource at all (fuzzy included). Kept for callers that
 * only need the hard-unmatched set. For the full three-way split (including
 * "close enough" suggestions and denials) use categorizeResourceNames.
 */
export function findUnmatchedNames(
  crews: Crew[],
  rforceOrders: RForceOrder[],
  timeOffRequests: TimeOffRequest[]
): UnmatchedName[] {
  const out: UnmatchedName[] = [];
  for (const { name, source } of collectNames(rforceOrders, timeOffRequests)) {
    if (!matchesCrew(name, crews)) out.push({ name, source });
  }
  return out;
}
