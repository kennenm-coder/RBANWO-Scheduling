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
  // Try with precision columns first; fall back to basic if migration not yet applied
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] | null = null;
  const full = await sb
    .from("sched_geocode_cache")
    .select("lat, lng, precision, manual_override")
    .eq("address_hash", hash)
    .limit(1);
  data = full.data;
  if (!data) {
    // Columns may not exist yet — fall back to basic select
    const fallback = await sb
      .from("sched_geocode_cache")
      .select("lat, lng")
      .eq("address_hash", hash)
      .limit(1);
    data = fallback.data;
  }
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
  // Try with precision columns; fall back to basic if migration not applied yet
  const { error } = await sb.from("sched_geocode_cache").upsert({
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
  if (error) {
    // Columns may not exist — try basic upsert
    await sb.from("sched_geocode_cache").upsert({
      address_hash: hash,
      address_original: address,
      lat,
      lng,
      geocoded_at: new Date().toISOString(),
      source: provider,
    });
  }
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

function extractState(address: string): string | null {
  const match = address.match(/,\s*(\w{2})\s+\d{5}/);
  return match ? match[1].toUpperCase() : null;
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

export async function manualCorrectGeocode(address: string, lat: number, lng: number): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const hash = addressHash(address);
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
  if (error) {
    await sb.from("sched_geocode_cache").upsert({
      address_hash: hash,
      address_original: address,
      lat,
      lng,
      geocoded_at: new Date().toISOString(),
      source: "manual",
    });
  }
}

export { extractState, isResultInState, STATE_BOUNDS };

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] | null = null;
    const full = await sb
      .from("sched_geocode_cache")
      .select("address_hash, lat, lng, precision, manual_override")
      .in("address_hash", batch);
    data = full.data;
    if (!data) {
      // Columns may not exist yet — fall back
      const fallback = await sb
        .from("sched_geocode_cache")
        .select("address_hash, lat, lng")
        .in("address_hash", batch);
      data = fallback.data;
    }
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
