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
    .single();
  if (data?.lat != null && data?.lng != null) {
    return { lat: data.lat, lng: data.lng };
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

export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  const cached = await getCachedGeocode(address);
  if (cached) return cached;

  try {
    const q = encodeURIComponent(address);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
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

    await saveGeocode(address, lat, lng);
    return { lat, lng };
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
