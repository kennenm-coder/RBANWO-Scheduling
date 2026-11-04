/**
 * Matching one job's address against another's.
 *
 * Service work orders and the installs they follow are separate Salesforce
 * records, so a write-up filed against the install carries whatever address
 * string that record held — "123 N Main St, Springfield, OR 97477" against
 * "123 North Main Street" is the same house to a person and two different
 * strings to a database. Write-ups are therefore grouped by a normalized key
 * rather than by the raw text.
 *
 * The key is the street line alone (everything before the first comma, when
 * there is one). City and state spellings drift far more than the street line
 * does, and the ZIP is carried separately as a tie-breaker so two "123 Main St"
 * in different towns don't collapse into one address.
 */

const SUFFIXES: Record<string, string> = {
  street: "st",
  avenue: "ave",
  av: "ave",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  place: "pl",
  boulevard: "blvd",
  circle: "cir",
  trail: "trl",
  terrace: "ter",
  parkway: "pkwy",
  highway: "hwy",
  square: "sq",
  point: "pt",
  crossing: "xing",
  loop: "loop",
  way: "way",
};

const DIRECTIONS: Record<string, string> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};

const UNIT_WORDS = new Set(["apt", "apartment", "unit", "ste", "suite", "bldg", "building", "lot", "trlr"]);

export interface AddressKey {
  /** Normalized street line. Empty when the address has no usable street. */
  street: string;
  /** 5-digit ZIP when the address carried one, else "". */
  zip: string;
}

/**
 * The street line and ZIP of an address, normalized for comparison.
 *
 * Returns an empty street for anything that doesn't look like a street address
 * (a bare city, a blank field). An empty street never matches, which is the
 * safe direction: we'd rather show no write-ups than someone else's.
 */
export function addressKey(raw: string | null | undefined): AddressKey {
  const text = (raw || "").trim();
  if (!text) return { street: "", zip: "" };

  const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/);
  const zip = zipMatch ? zipMatch[1] : "";

  // The street line: up to the first comma, or the whole string when the
  // address was stored as one unpunctuated run.
  const line = text.split(",")[0];

  const words = line
    .toLowerCase()
    .replace(/[.#]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const out: string[] = [];
  for (const w of words) {
    if (UNIT_WORDS.has(w)) continue; // "apt 2" and "2" read the same
    out.push(SUFFIXES[w] || DIRECTIONS[w] || w);
  }

  const street = out.join(" ");
  // Needs a house number to be a street address at all.
  if (!/^\d/.test(street)) return { street: "", zip };
  return { street, zip };
}

/**
 * Do two addresses point at the same place?
 *
 * ZIPs are compared only when both sides have one — a write-up stored with the
 * street line alone should still match the service order it belongs to.
 */
export function addressesMatch(a: AddressKey, b: AddressKey): boolean {
  if (!a.street || !b.street) return false;
  if (a.street !== b.street) return false;
  if (a.zip && b.zip && a.zip !== b.zip) return false;
  return true;
}
