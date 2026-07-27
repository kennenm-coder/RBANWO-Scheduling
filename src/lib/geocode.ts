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

const ROAD_ABBREVS: [RegExp, string][] = [
  [/\bCounty Road\b/gi, "CR"],
  [/\bCrk\b/gi, "Creek"],
  [/\bHwy\b/gi, "Highway"],
  [/\bOHIO HWY\b/gi, "OH"],
  [/\bState Route\b/gi, "SR"],
  [/\bSt\b(?=\s+\d)/gi, "Street"],
  [/\bDr\b/gi, "Drive"],
  [/\bAve\b/gi, "Avenue"],
  [/\bRd\b/gi, "Road"],
  [/\bLn\b/gi, "Lane"],
  [/\bCt\b/gi, "Court"],
  [/\bPl\b/gi, "Place"],
  [/\bBlvd\b/gi, "Boulevard"],
  [/\bPkwy\b/gi, "Parkway"],
];

function cleanAddress(address: string): string[] {
  const variants: string[] = [];
  let cleaned = address
    .replace(/\s+United States$/i, "")
    .replace(/\s+US$/i, "")
    .trim();
  variants.push(cleaned);

  let expanded = cleaned;
  for (const [pattern, replacement] of ROAD_ABBREVS) {
    expanded = expanded.replace(pattern, replacement);
  }
  if (expanded !== cleaned) variants.push(expanded);

  const countyRd = cleaned.replace(/County Road\s+/i, "CR ");
  if (countyRd !== cleaned && countyRd !== expanded) variants.push(countyRd);

  const stateZip = cleaned.match(/,\s*(\w+)\s+(\d{5})/);
  if (stateZip) {
    const structured = cleaned.replace(/,\s*(\w+)\s+(\d{5}).*$/, "");
    variants.push(`${structured}, ${stateZip[1]} ${stateZip[2]}`);
  }

  return variants;
}

function parseAddressParts(address: string): { street: string; city: string; state: string; zip: string } | null {
  const cleaned = address.replace(/\s+United States$/i, "").replace(/\s+US$/i, "").trim();
  const match = cleaned.match(/^(.+?),\s*(.+?),\s*(\w+)\s+(\d{5})/);
  if (!match) return null;
  return { street: match[1].trim(), city: match[2].trim(), state: match[3].trim(), zip: match[4] };
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

async function nominatimStructured(parts: { street: string; city: string; state: string; zip: string }): Promise<GeoResult | null> {
  const params = new URLSearchParams({
    street: parts.street,
    city: parts.city,
    state: parts.state,
    postalcode: parts.zip,
    country: "US",
    format: "json",
    limit: "1",
  });
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: { "User-Agent": "RBANWO-Scheduling/1.0 (kennen.m@rbanwo.com)" } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

async function censusGeocode(address: string): Promise<GeoResult | null> {
  const cleaned = address.replace(/\s+United States$/i, "").replace(/\s+US$/i, "").trim();
  const res = await fetch(
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(cleaned)}&benchmark=Public_AR_Current&format=json`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;
  const lat = match.coordinates.y;
  const lng = match.coordinates.x;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
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
    // 1. Try US Census geocoder first (free, no rate limit, best for US addresses)
    const censusResult = await censusGeocode(address);
    if (censusResult) {
      await saveGeocode(address, censusResult.lat, censusResult.lng);
      return censusResult;
    }

    // 2. Try Nominatim free-form
    const result = await nominatimLookup(address);
    if (result) {
      await saveGeocode(address, result.lat, result.lng);
      return result;
    }

    // 3. Try Nominatim structured query
    const parts = parseAddressParts(address);
    if (parts) {
      await new Promise((r) => setTimeout(r, 1100));
      const structured = await nominatimStructured(parts);
      if (structured) {
        await saveGeocode(address, structured.lat, structured.lng);
        return structured;
      }
    }

    // 4. Try cleaned address variants
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

    // 5. Fall back to zip code center (~2 mile accuracy)
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
    const { data } = await sb
      .from("sched_geocode_cache")
      .select("address_hash, lat, lng")
      .in("address_hash", batch);
    if (data) {
      for (const row of data) {
        if (row.lat != null && row.lng != null) {
          const addr = hashToAddr.get(row.address_hash);
          if (addr) results.set(addr, { lat: row.lat, lng: row.lng });
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
      await new Promise((r) => setTimeout(r, 1100));
      geo = await nominatimZipFallback(zip) ?? undefined;
      if (geo) await saveGeocode(`zip:${zip}`, geo.lat, geo.lng);
    }
    if (geo) {
      for (const addr of addrs) {
        if (!results.has(addr)) results.set(addr, geo);
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
