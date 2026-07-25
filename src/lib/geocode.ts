import { getSupabase } from "./supabase";

export interface GeoResult {
  lat: number;
  lng: number;
}

function addressHash(address: string): string {
  return address.toLowerCase().trim().replace(/\s+/g, " ");
}

export async function getCachedGeocode(address: string): Promise<GeoResult | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const hash = addressHash(address);
  const { data } = await sb
    .from("sched_geocode_cache")
    .select("lat, lng")
    .eq("address_hash", hash)
    .limit(1);
  const row = data?.[0];
  if (row?.lat != null && row?.lng != null) {
    return { lat: row.lat, lng: row.lng };
  }
  return null;
}

export async function saveGeocode(address: string, lat: number, lng: number): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const hash = addressHash(address);
  await sb.from("sched_geocode_cache").upsert({
    address_hash: hash,
    address_original: address,
    lat,
    lng,
    geocoded_at: new Date().toISOString(),
    source: "nominatim",
  });
}

function extractZip(address: string): string | null {
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

function cleanAddress(address: string): string[] {
  const variants: string[] = [];
  let cleaned = address
    .replace(/\s+United States$/i, "")
    .replace(/\s+US$/i, "")
    .trim();
  variants.push(cleaned);

  const countyRd = cleaned.replace(/County Road\s+/i, "CR ");
  if (countyRd !== cleaned) variants.push(countyRd);

  const stateZip = cleaned.match(/,\s*(\w+)\s+(\d{5})/);
  if (stateZip) {
    const structured = cleaned.replace(/,\s*(\w+)\s+(\d{5}).*$/, "");
    variants.push(`${structured}, ${stateZip[1]} ${stateZip[2]}`);
  }

  return variants;
}

async function nominatimLookup(query: string): Promise<GeoResult | null> {
  const q = encodeURIComponent(query);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`,
    {
      headers: {
        "User-Agent": "RBANWO-Scheduling/1.0 (kennen.m@rbanwo.com)",
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

async function nominatimZipFallback(zip: string): Promise<GeoResult | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&limit=1`,
    {
      headers: {
        "User-Agent": "RBANWO-Scheduling/1.0 (kennen.m@rbanwo.com)",
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  const cached = await getCachedGeocode(address);
  if (cached) return cached;

  try {
    const result = await nominatimLookup(address);
    if (result) {
      await saveGeocode(address, result.lat, result.lng);
      return result;
    }

    const variants = cleanAddress(address);
    for (const variant of variants) {
      if (variant === address) continue;
      await new Promise((r) => setTimeout(r, 1100));
      const vResult = await nominatimLookup(variant);
      if (vResult) {
        await saveGeocode(address, vResult.lat, vResult.lng);
        return vResult;
      }
    }

    // Fall back to zip code center (~2 mile accuracy)
    const zip = extractZip(address);
    if (zip) {
      await new Promise((r) => setTimeout(r, 1100));
      const zipResult = await nominatimZipFallback(zip);
      if (zipResult) {
        await saveGeocode(address, zipResult.lat, zipResult.lng);
        return zipResult;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function geocodeBatch(
  addresses: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, GeoResult>> {
  const results = new Map<string, GeoResult>();
  const unique = [...new Set(addresses.filter(Boolean))];

  const uncached: string[] = [];
  for (const addr of unique) {
    const cached = await getCachedGeocode(addr);
    if (cached) {
      results.set(addr, cached);
    } else {
      uncached.push(addr);
    }
  }

  onProgress?.(results.size, unique.length);

  for (let i = 0; i < uncached.length; i++) {
    const addr = uncached[i];
    const geo = await geocodeAddress(addr);
    if (geo) results.set(addr, geo);
    onProgress?.(results.size, unique.length);
    if (i < uncached.length - 1) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  return results;
}
