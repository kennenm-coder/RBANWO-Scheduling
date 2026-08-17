/**
 * Overlap-lane assignment for timeline layouts (the Day view).
 *
 * Appointments whose time ranges overlap must not be drawn on top of each other.
 * We greedily pack them into horizontal "lanes" (stacked sub-rows): each item
 * takes the first lane whose previous item has already ended, otherwise a new
 * lane is opened. The row height then grows to fit `laneCount` lanes.
 */

export interface TimeRanged {
  id: string;
  start_time?: string | null;
  end_time?: string | null;
}

export interface LaneAssignment {
  /** appointment id → lane index (0-based, top lane is 0). */
  laneOf: Map<string, number>;
  /** total lanes needed (at least 1). */
  laneCount: number;
}

/**
 * Assign each item a lane so no two overlapping items share a lane.
 * Ties (same start) are ordered by end time, then id, for stable output.
 */
export function assignTimeLanes(items: TimeRanged[]): LaneAssignment {
  const laneOf = new Map<string, number>();
  if (items.length === 0) return { laneOf, laneCount: 1 };

  const norm = (v: string | null | undefined, fallback: string) =>
    v && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : fallback;

  const sorted = [...items].sort((a, b) => {
    const sa = norm(a.start_time, "00:00");
    const sb = norm(b.start_time, "00:00");
    if (sa !== sb) return sa < sb ? -1 : 1;
    const ea = norm(a.end_time, "23:59");
    const eb = norm(b.end_time, "23:59");
    if (ea !== eb) return ea < eb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // laneEnds[i] = end time of the last item placed in lane i.
  const laneEnds: string[] = [];
  for (const item of sorted) {
    const start = norm(item.start_time, "00:00");
    const end = norm(item.end_time, "23:59");
    let lane = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      // A lane is free once its previous item ends at or before this start.
      if (laneEnds[i] <= start) {
        lane = i;
        break;
      }
    }
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    laneOf.set(item.id, lane);
  }

  return { laneOf, laneCount: Math.max(1, laneEnds.length) };
}
