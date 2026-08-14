import { getSupabase } from "./supabase";

export type GeoPrecision = "rooftop" | "street" | "zip" | "unknown";

export interface GeoResult {
  lat: number;
  lng: number;
  precision?: GeoPrecision;
  manualOverride?: boolean;
}

function addressHash(address: string): string {
  return address.toLowerCase().trim().replace(/\s+/g, " ");
}

export async function getCachedGeocode(address: string): Promise<GeoResult | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const hash = addressHash(address);
  // Precision and manual_override columns are guaranteed by the authoritative schema
  const { data } = await sb
    .from("sched_geocode_cache")
    .select("lat, lng, precision, manual_override")
    .eq("address_hash", hash)
    .limit(1);
  const row = data?.[0];
  if (row?.lat != null && row?.lng != null) {
    return {
      lat: row.lat,
      lng: row.lng,
      precision: (row.precision as GeoPrecision) || "unknown",
      manualOverride: row.manual_override === true,
    };
  }
  return null;
}

export async function saveGeocode(
  address: string,
  lat: number,
  lng: number,
  precision: GeoPrecision = "unknown",
  provider = "nominatim",
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const hash = addressHash(address);
  // All columns guaranteed by the authoritative schema
  await sb.from("sched_geocode_cache").upsert({
    address_hash: hash,
    address_original: address,
    lat,
    lng,
    precision,
    provider,
    geocoded_at: new Date().toISOString(),
    source: provider,
    updated_at: new Date().toISOString(),
  });
}

async function deleteCachedGeocode(address: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const hash = addressHash(address);
  await sb.from("sched_geocode_cache").delete().eq("address_hash", hash);
}

function extractZip(address: string): string | null {
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

// Address cleaning / parsing / road abbreviation expansion moved to /api/geocode server-side.

const STATE_BOUNDS: Record<string, { latMin: number; latMax: number; lngMin: number; lngMax: number }> = {
  OH: { latMin: 38.4, latMax: 42.0, lngMin: -84.9, lngMax: -80.5 },
  MI: { latMin: 41.7, latMax: 48.3, lngMin: -90.5, lngMax: -82.1 },
  IN: { latMin: 37.8, latMax: 41.8, lngMin: -88.1, lngMax: -84.8 },
  PA: { latMin: 39.7, latMax: 42.3, lngMin: -80.6, lngMax: -74.7 },
  WV: { latMin: 37.2, latMax: 40.7, lngMin: -82.7, lngMax: -77.7 },
  KY: { latMin: 36.5, latMax: 39.2, lngMin: -89.6, lngMax: -81.9 },
};

/** Map full state names → 2-letter codes so "Ohio 43604" works the same as "OH 43604" */
const STATE_NAME_TO_ABBR: Record<string, string> = {
  ohio: "OH",
  michigan: "MI",
  indiana: "IN",
  pennsylvania: "PA",
  "west virginia": "WV",
  kentucky: "KY",
  illinois: "IL",
  "new york": "NY",
  virginia: "VA",
  tennessee: "TN",
  wisconsin: "WI",
  minnesota: "MN",
};

function extractState(address: string): string | null {
  // Try 2-letter abbreviation first: ", OH 43604"
  const abbrMatch = address.match(/,\s*(\w{2})\s+\d{5}/);
  if (abbrMatch) return abbrMatch[1].toUpperCase();

  // Try full state name: ", Ohio 43604" or ", West Virginia 25301"
  const nameMatch = address.match(/,\s*([\w\s]+?)\s+\d{5}/);
  if (nameMatch) {
    const name = nameMatch[1].trim().toLowerCase();
    const abbr = STATE_NAME_TO_ABBR[name];
    if (abbr) return abbr;
  }

  return null;
}

/**
 * Service area bounding box — the rough rectangle covering all states
 * we operate in. Coordinates outside this box are definitely wrong.
 */
const SERVICE_AREA = { latMin: 36.0, latMax: 49.0, lngMin: -91.0, lngMax: -74.0 };

/**
 * Validate that coordinates are plausible:
 * 1. Not zero/null (0,0 is the Gulf of Guinea — definitely wrong)
 * 2. Within the service area bounding box
 * 3. If the address names a known state, within that state's bounds
 */
export function validateCoordinates(
  lat: number,
  lng: number,
  address?: string | null
): { valid: boolean; reason?: string } {
  // Reject (0,0) or very small values that look like defaults
  if (lat === 0 && lng === 0) return { valid: false, reason: "Coordinates are 0,0 (default/missing)" };
  if (Math.abs(lat) < 1 && Math.abs(lng) < 1) return { valid: false, reason: "Coordinates near origin" };

  // Must be within the service area
  if (lat < SERVICE_AREA.latMin || lat > SERVICE_AREA.latMax ||
      lng < SERVICE_AREA.lngMin || lng > SERVICE_AREA.lngMax) {
    return { valid: false, reason: "Outside service area" };
  }

  // If we can identify the state from the address, check state bounds
  if (address) {
    const state = extractState(address);
    if (state && STATE_BOUNDS[state]) {
      const b = STATE_BOUNDS[state];
      if (lat < b.latMin || lat > b.latMax || lng < b.lngMin || lng > b.lngMax) {
        return { valid: false, reason: `Outside ${state} bounds` };
      }
    }
  }

  return { valid: true };
}

function isResultInState(geo: GeoResult, state: string): boolean {
  const bounds = STATE_BOUNDS[state];
  if (!bounds) return true;
  return geo.lat >= bounds.latMin && geo.lat <= bounds.latMax &&
         geo.lng >= bounds.lngMin && geo.lng <= bounds.lngMax;
}

// All external geocoding goes through /api/geocode to avoid CORS issues.
// The API route calls Nominatim/Census server-side.

async function proxyGeocode(address: string, mode?: "zip"): Promise<GeoResult | null> {
  try {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, mode }),
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    if (!result) return null;
    return {
      lat: result.lat,
      lng: result.lng,
      precision: (result.precision as GeoPrecision) || "unknown",
    };
  } catch {
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  const cached = await getCachedGeocode(address);
  const state = extractState(address);

  if (cached) {
    if (cached.manualOverride) return cached;  // never overwrite manual corrections
    if (state && !isResultInState(cached, state)) {
      await deleteCachedGeocode(address);
    } else {
      return cached;
    }
  }

  function validate(geo: GeoResult | null): GeoResult | null {
    if (!geo) return null;
    if (state && !isResultInState(geo, state)) return null;
    return geo;
  }

  try {
    // Server-side geocode via /api/geocode (handles Census → Nominatim → structured → zip fallback)
    const result = await proxyGeocode(address);
    if (result) {
      const validated = validate(result);
      if (validated) {
        await saveGeocode(address, validated.lat, validated.lng, validated.precision || "unknown", "api");
        return validated;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearAndReGeocode(address: string): Promise<GeoResult | null> {
  await deleteCachedGeocode(address);
  return geocodeAddress(address);
}

export async function manualCorrectGeocode(
  address: string,
  lat: number,
  lng: number,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "No database connection" };
  const hash = addressHash(address);
  // All columns guaranteed by the authoritative schema
  const { error } = await sb.from("sched_geocode_cache").upsert({
    address_hash: hash,
    address_original: address,
    lat,
    lng,
    precision: "rooftop",
    provider: "manual",
    manual_override: true,
    geocoded_at: new Date().toISOString(),
    source: "manual",
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Update the latitude/longitude on a work_orders row in Supabase.
 * Returns success/failure so the UI can show accurate feedback.
 */
export async function updateWorkOrderCoords(
  workOrderNumber: string,
  lat: number,
  lng: number,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "No database connection" };
  const { error } = await sb
    .from("work_orders")
    .update({ latitude: lat, longitude: lng })
    .eq("work_order_number", workOrderNumber);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Run the geocoder for an address WITHOUT saving to cache.
 * Used for "verify" comparisons against database coordinates.
 */
export async function geocodeForComparison(address: string): Promise<GeoResult | null> {
  try {
    const res = await fetch("/api/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    if (!result) return null;
    return {
      lat: result.lat,
      lng: result.lng,
      precision: (result.precision as GeoPrecision) || "unknown",
    };
  } catch {
    return null;
  }
}

export { extractState, isResultInState, STATE_BOUNDS, SERVICE_AREA };

async function bulkCacheLookup(addresses: string[]): Promise<Map<string, GeoResult>> {
  const results = new Map<string, GeoResult>();
  const sb = getSupabase();
  if (!sb) return results;
  const hashes = addresses.map(addressHash);
  const hashToAddr = new Map<string, string>();
  addresses.forEach((addr, i) => hashToAddr.set(hashes[i], addr));
  const BATCH = 200;
  for (let i = 0; i < hashes.length; i += BATCH) {
    const batch = hashes.slice(i, i + BATCH);
    // All columns guaranteed by the authoritative schema
    const { data } = await sb
      .from("sched_geocode_cache")
      .select("address_hash, lat, lng, precision, manual_override")
      .in("address_hash", batch);
    if (data) {
      for (const row of data) {
        if (row.lat != null && row.lng != null) {
          const addr = hashToAddr.get(row.address_hash);
          if (addr) results.set(addr, {
            lat: row.lat,
            lng: row.lng,
            precision: (row.precision as GeoPrecision) || "unknown",
            manualOverride: row.manual_override === true,
          });
        }
      }
    }
  }
  return results;
}

export async function geocodeFastZip(
  addresses: string[]
): Promise<Map<string, GeoResult>> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const results = await bulkCacheLookup(unique);
  const uncached = unique.filter((addr) => !results.has(addr));
  if (uncached.length === 0) return results;

  const zipToAddrs = new Map<string, string[]>();
  for (const addr of uncached) {
    const zip = extractZip(addr);
    if (zip) {
      const list = zipToAddrs.get(zip) || [];
      list.push(addr);
      zipToAddrs.set(zip, list);
    }
  }

  const zipCache = await bulkCacheLookup([...zipToAddrs.keys()].map((z) => `zip:${z}`));

  for (const [zip, addrs] of zipToAddrs) {
    let geo = zipCache.get(`zip:${zip}`);
    if (!geo) {
      geo = await proxyGeocode(zip, "zip") ?? undefined;
      if (geo) await saveGeocode(`zip:${zip}`, geo.lat, geo.lng, "zip", "nominatim_zip");
    }
    if (geo) {
      for (const addr of addrs) {
        if (!results.has(addr)) results.set(addr, { ...geo, precision: "zip" });
      }
    }
  }

  return results;
}

export async function geocodeBatch(
  addresses: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, GeoResult>> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const results = await bulkCacheLookup(unique);
  const uncached = unique.filter((addr) => !results.has(addr));

  onProgress?.(results.size, unique.length);

  // Process uncached addresses — rate limiting is handled server-side in /api/geocode
  for (let i = 0; i < uncached.length; i++) {
    const addr = uncached[i];
    const geo = await geocodeAddress(addr);
    if (geo) results.set(addr, geo);
    onProgress?.(results.size, unique.length);
  }

  return results;
}
