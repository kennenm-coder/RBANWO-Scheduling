/**
 * Small, dependency-free helpers for mapping an rForce resource name to a crew
 * and an rForce hour to a time block. Kept in their own leaf module (types only)
 * so both calendar-utils and issues can import them without pulling the heavy
 * calendar-utils module into every consumer's bundle.
 */
import type { Crew, ResourceMapping, TimeBlock } from "./types";

export function timeToBlock(hour: number): TimeBlock {
  if (hour < 10) return "9-10";
  if (hour < 12) return "10-12";
  if (hour < 14) return "12-2";
  if (hour < 16) return "2-4";
  return "4-6";
}

export function matchCrewByMapping(
  resourceName: string,
  crews: Crew[],
  mappings: ResourceMapping[]
): Crew | undefined {
  const lower = resourceName.toLowerCase().trim();
  const mapping = mappings.find((m) => m.raw_name.toLowerCase() === lower);
  if (mapping) return crews.find((c) => c.id === mapping.crew_id);
  return undefined;
}

export function matchCrewByName(
  resourceName: string,
  crews: Crew[],
  mappings?: ResourceMapping[]
): Crew | undefined {
  if (mappings && mappings.length > 0) {
    const mapped = matchCrewByMapping(resourceName, crews, mappings);
    if (mapped) return mapped;
  }
  const lower = resourceName.toLowerCase().trim();
  const exact = crews.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact;
  const aliasMatch = crews.find((c) =>
    c.aliases?.some((a) => a.toLowerCase() === lower)
  );
  if (aliasMatch) return aliasMatch;
  const firstName = lower.split(" ")[0];
  return crews.find((c) => c.name.toLowerCase().split(" ")[0] === firstName);
}
