/**
 * Fuzzy matching engine for detecting when an rForce order likely matches
 * an existing in-app appointment. Uses weighted signals: customer name,
 * date, crew, address, type, and time proximity.
 */

import {
  Appointment,
  RForceOrder,
  Crew,
  ResourceMapping,
  FuzzyMatchCandidate,
  MatchConfidence,
} from "./types";
import {
  normalizeWoType,
  TIME_BLOCK_HOUR,
  extractHour,
  getRForceResource,
} from "./normalize";

// ── Scoring weights ──

const SCORE_NAME_EXACT = 40;
const SCORE_NAME_FIRST = 25;
const SCORE_NAME_FUZZY = 20;
const SCORE_DATE_EXACT = 30;
const SCORE_DATE_NEAR = 15;       // within ±1 day
const SCORE_CREW_MATCH = 20;
const SCORE_ADDRESS_MATCH = 15;
const SCORE_TYPE_MATCH = 10;
const SCORE_TIME_NEAR = 5;

const THRESHOLD_HIGH = 60;
const THRESHOLD_MEDIUM = 40;

// ── Helpers ──

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function firstName(s: string): string {
  return normalize(s).split(" ")[0] || "";
}

function lastName(s: string): string {
  const parts = normalize(s).split(" ");
  return parts[parts.length - 1] || "";
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Cap at 60 chars to avoid perf issues with very long strings
  const sa = a.slice(0, 60);
  const sb = b.slice(0, 60);
  const matrix: number[][] = [];
  for (let i = 0; i <= sa.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= sb.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = sa[i - 1] === sb[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
  }
  return matrix[sa.length][sb.length];
}

function dateDiffDays(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs(Math.round((da.getTime() - db.getTime()) / 86400000));
}

function normalizeAddress(s: string): string {
  return normalize(s).replace(/\b(street|st|avenue|ave|drive|dr|road|rd|lane|ln|court|ct|boulevard|blvd)\b/g, "").replace(/\s+/g, " ").trim();
}

/** Check if an rForce resource name matches a crew (case-insensitive first name). */
function resourceMatchesCrew(
  resourceName: string,
  crew: Crew,
  mappings: ResourceMapping[]
): boolean {
  // Check mappings first
  const mapping = mappings.find(
    (m) => m.raw_name.toLowerCase() === resourceName.toLowerCase() && m.crew_id === crew.id && m.is_active
  );
  if (mapping) return true;

  // Fallback: first-name match
  const rfFirst = firstName(resourceName);
  const crewFirst = firstName(crew.name);
  return rfFirst.length >= 2 && crewFirst.length >= 2 && rfFirst === crewFirst;
}

// ── Pre-computed appointment index for batch fuzzy matching ──

export interface FuzzyMatchIndex {
  /** Appointments eligible for matching (not cancelled, not linked, has schedule data) */
  eligible: Appointment[];
  /** Pre-computed normalized customer names keyed by appointment id */
  normalizedNames: Map<string, string>;
  /** Pre-computed first names keyed by appointment id */
  firstNames: Map<string, string>;
  /** Pre-computed last names keyed by appointment id */
  lastNames: Map<string, string>;
  /** Pre-computed normalized addresses keyed by appointment id (first 15 chars) */
  addressPrefixes: Map<string, string>;
  /** Crews keyed by id */
  crewMap: Map<string, Crew>;
  /** Appointments indexed by date for fast ±1 day lookup */
  byDate: Map<string, Appointment[]>;
}

/**
 * Build a reusable index for fuzzy matching. Call once per queue rebuild,
 * then pass to findFuzzyMatchesIndexed for each rForce order.
 * This avoids re-normalizing the same names/addresses N×M times.
 */
export function buildFuzzyMatchIndex(
  appointments: Appointment[],
  crews: Crew[],
  activeLinkedAppointmentIds: Set<string>
): FuzzyMatchIndex {
  const eligible: Appointment[] = [];
  const normalizedNames = new Map<string, string>();
  const firstNames = new Map<string, string>();
  const lastNames = new Map<string, string>();
  const addressPrefixes = new Map<string, string>();
  const byDate = new Map<string, Appointment[]>();

  for (const appt of appointments) {
    if (appt.status === "cancelled" || appt.status === "unscheduled") continue;
    if (activeLinkedAppointmentIds.has(appt.id)) continue;
    if (!appt.scheduled_date || !appt.crew_id) continue;

    eligible.push(appt);

    // Pre-compute name variants
    if (appt.customer_name) {
      normalizedNames.set(appt.id, normalize(appt.customer_name));
      firstNames.set(appt.id, firstName(appt.customer_name));
      lastNames.set(appt.id, lastName(appt.customer_name));
    }

    // Pre-compute address prefix
    if (appt.address) {
      addressPrefixes.set(appt.id, normalizeAddress(appt.address).slice(0, 15));
    }

    // Index by date (and adjacent dates for ±1 day lookup)
    const existing = byDate.get(appt.scheduled_date) || [];
    existing.push(appt);
    byDate.set(appt.scheduled_date, existing);
  }

  const crewMap = new Map(crews.map((c) => [c.id, c]));
  return { eligible, normalizedNames, firstNames, lastNames, addressPrefixes, crewMap, byDate };
}

// ── Main function ──

/**
 * Find app appointments that fuzzy-match a given rForce order.
 * Returns matches sorted by score (highest first), filtered by confidence threshold.
 *
 * Only considers appointments that:
 * - Are not cancelled or unscheduled
 * - Are not already linked to a different rForce order
 * - Have a work_order_number that is null OR matches this rForce order
 *
 * @param rejectedPairs - Set of "appointmentId|workOrderNumber" keys for
 *   matches the scheduler has explicitly rejected. These are excluded from results.
 */
export function findFuzzyMatches(
  rforceOrder: RForceOrder,
  appointments: Appointment[],
  crews: Crew[],
  mappings: ResourceMapping[],
  activeLinkedAppointmentIds: Set<string>,
  rejectedPairs?: Set<string>
): FuzzyMatchCandidate[] {
  // Build a one-off index (use buildFuzzyMatchIndex + findFuzzyMatchesIndexed for batch)
  const index = buildFuzzyMatchIndex(appointments, crews, activeLinkedAppointmentIds);
  return findFuzzyMatchesIndexed(rforceOrder, index, mappings, rejectedPairs);
}

/**
 * Indexed version — uses a pre-built FuzzyMatchIndex for batch operations.
 * Call buildFuzzyMatchIndex once, then call this for each rForce order.
 */
export function findFuzzyMatchesIndexed(
  rforceOrder: RForceOrder,
  index: FuzzyMatchIndex,
  mappings: ResourceMapping[],
  rejectedPairs?: Set<string>
): FuzzyMatchCandidate[] {
  const rfDate = rforceOrder.scheduled_start?.slice(0, 10);
  const rfName = rforceOrder.customer_name || "";
  const rfAddress = rforceOrder.address || "";
  const rfResource = getRForceResource(rforceOrder);
  const rfTypeMapped = normalizeWoType(rforceOrder.work_order_type);
  const rfHour = rforceOrder.scheduled_start ? extractHour(rforceOrder.scheduled_start) : null;

  // Pre-compute rForce name variants once per call (not per appointment)
  const nRfName = rfName ? normalize(rfName) : "";
  const rfFirst = rfName ? firstName(rfName) : "";
  const rfLast = rfName ? lastName(rfName) : "";
  const nRfAddr = rfAddress ? normalizeAddress(rfAddress).slice(0, 15) : "";

  const candidates: FuzzyMatchCandidate[] = [];

  for (const appt of index.eligible) {
    // Skip if appointment already has a different WO#
    if (
      appt.work_order_number &&
      appt.work_order_number !== rforceOrder.work_order_number
    ) continue;
    // Skip if scheduler rejected this specific match
    if (rejectedPairs?.has(`${appt.id}|${rforceOrder.work_order_number}`)) continue;

    let score = 0;
    const reasons: string[] = [];

    // ── Customer name (using pre-computed values) ──
    if (nRfName) {
      const nApp = index.normalizedNames.get(appt.id);
      if (nApp) {
        if (nRfName === nApp) {
          score += SCORE_NAME_EXACT;
          reasons.push("Same customer name");
        } else {
          const appLast = index.lastNames.get(appt.id) || "";
          if (rfLast === appLast && rfLast.length >= 3) {
            score += SCORE_NAME_FIRST;
            reasons.push("Same last name");
          } else {
            const appFirst = index.firstNames.get(appt.id) || "";
            if (rfFirst === appFirst && rfFirst.length >= 2) {
              score += SCORE_NAME_FIRST;
              reasons.push("Same first name");
            } else if (levenshtein(nRfName, nApp) <= 2) {
              score += SCORE_NAME_FUZZY;
              reasons.push("Similar name");
            }
          }
        }
      }
    }

    // ── Date ──
    if (rfDate && appt.scheduled_date) {
      const diff = dateDiffDays(rfDate, appt.scheduled_date);
      if (diff === 0) {
        score += SCORE_DATE_EXACT;
        reasons.push("Same date");
      } else if (diff <= 1) {
        score += SCORE_DATE_NEAR;
        reasons.push("Date within 1 day");
      }
    }

    // ── Early exit: if no name or date score, can't reach threshold ──
    // Max remaining = crew(20) + address(15) + type(10) + time(5) = 50
    // But we need at least THRESHOLD_MEDIUM (40). Without name or date,
    // max is 50 which can only reach medium if ALL other signals match.
    // Skip Levenshtein-heavy work for clearly-unrelated appointments.
    if (score === 0 && rfDate && appt.scheduled_date) {
      const diff = dateDiffDays(rfDate, appt.scheduled_date);
      if (diff > 1) continue; // No date proximity, no name match — skip
    }

    // ── Crew (using pre-indexed crew map) ──
    if (rfResource && appt.crew_id) {
      const crew = index.crewMap.get(appt.crew_id);
      if (crew && resourceMatchesCrew(rfResource, crew, mappings)) {
        score += SCORE_CREW_MATCH;
        reasons.push("Same crew");
      }
    }

    // ── Address (using pre-computed prefix) ──
    if (nRfAddr) {
      const appPrefix = index.addressPrefixes.get(appt.id);
      if (appPrefix && nRfAddr === appPrefix && nRfAddr.length >= 5) {
        score += SCORE_ADDRESS_MATCH;
        reasons.push("Same address");
      }
    }

    // ── Appointment type ──
    if (rfTypeMapped && rfTypeMapped === appt.appointment_type) {
      score += SCORE_TYPE_MATCH;
      reasons.push("Same type");
    }

    // ── Time proximity ──
    if (rfHour !== null && appt.time_block) {
      const expectedHour = TIME_BLOCK_HOUR[appt.time_block];
      if (expectedHour !== undefined && Math.abs(rfHour - expectedHour) <= 2) {
        score += SCORE_TIME_NEAR;
        reasons.push("Similar time");
      }
    }

    // ── Threshold check ──
    if (score >= THRESHOLD_MEDIUM) {
      const confidence: MatchConfidence = score >= THRESHOLD_HIGH ? "high" : "medium";
      candidates.push({
        appointment: appt,
        rforceOrder,
        confidence,
        matchReasons: reasons,
        score,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
