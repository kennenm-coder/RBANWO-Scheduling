import { NextRequest, NextResponse } from "next/server";

// Server-side geocoding proxy — avoids CORS issues with Nominatim/Census
// These APIs don't allow browser-origin requests, so we proxy through our own server.

async function censusGeocode(address: string) {
  const cleaned = address.replace(/\s+United States$/i, "").replace(/\s+US$/i, "").trim();
  const res = await fetch(
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(cleaned)}&benchmark=Public_AR_Current&format=json`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;
  const lat = match.coordinates.y;
  const lng = match.coordinates.x;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng, precision: "rooftop" as const, provider: "census" };
}

async function nominatimLookup(query: string) {
  const q = encodeURIComponent(query);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`,
    {
      headers: { "User-Agent": "RBANWO-Scheduling/1.0 (kennen.m@rbanwo.com)" },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng, precision: "street" as const, provider: "nominatim" };
}

function parseAddressParts(address: string) {
  const cleaned = address.replace(/\s+United States$/i, "").replace(/\s+US$/i, "").trim();
  const match = cleaned.match(/^(.+?),\s*(.+?),\s*(\w+)\s+(\d{5})/);
  if (!match) return null;
  return { street: match[1].trim(), city: match[2].trim(), state: match[3].trim(), zip: match[4] };
}

async function nominatimStructured(parts: { street: string; city: string; state: string; zip: string }) {
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
    {
      headers: { "User-Agent": "RBANWO-Scheduling/1.0 (kennen.m@rbanwo.com)" },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng, precision: "street" as const, provider: "nominatim_structured" };
}

async function nominatimZipFallback(zip: string) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&limit=1`,
    {
      headers: { "User-Agent": "RBANWO-Scheduling/1.0 (kennen.m@rbanwo.com)" },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng, precision: "zip" as const, provider: "nominatim_zip" };
}

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

function isResultInState(geo: { lat: number; lng: number }, state: string): boolean {
  const bounds = STATE_BOUNDS[state];
  if (!bounds) return true;
  return geo.lat >= bounds.latMin && geo.lat <= bounds.latMax &&
         geo.lng >= bounds.lngMin && geo.lng <= bounds.lngMax;
}

function extractZip(address: string): string | null {
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

export async function POST(request: NextRequest) {
  try {
    const { address, mode } = await request.json();

    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "address required" }, { status: 400 });
    }

    // "zip" mode — just look up the zip centroid (fast path)
    if (mode === "zip") {
      const zip = extractZip(address);
      if (!zip) return NextResponse.json({ result: null });
      const result = await nominatimZipFallback(zip);
      return NextResponse.json({ result });
    }

    const state = extractState(address);

    function validate(geo: { lat: number; lng: number } | null) {
      if (!geo) return null;
      if (state && !isResultInState(geo, state)) return null;
      return geo;
    }

    // 1. Census geocoder (best for US, no rate limit)
    const censusResult = validate(await censusGeocode(address));
    if (censusResult) {
      return NextResponse.json({
        result: { ...censusResult, precision: "rooftop", provider: "census" },
      });
    }

    // 2. Nominatim free-form
    const nomResult = validate(await nominatimLookup(address));
    if (nomResult) {
      return NextResponse.json({
        result: { ...nomResult, precision: "street", provider: "nominatim" },
      });
    }

    // 3. Nominatim structured
    const parts = parseAddressParts(address);
    if (parts) {
      const structured = validate(await nominatimStructured(parts));
      if (structured) {
        return NextResponse.json({
          result: { ...structured, precision: "street", provider: "nominatim_structured" },
        });
      }
    }

    // 4. Zip fallback
    const zip = extractZip(address);
    if (zip) {
      const zipResult = await nominatimZipFallback(zip);
      if (zipResult) {
        return NextResponse.json({
          result: { ...zipResult, precision: "zip", provider: "nominatim_zip" },
        });
      }
    }

    return NextResponse.json({ result: null });
  } catch {
    return NextResponse.json({ error: "geocode failed" }, { status: 500 });
  }
}
