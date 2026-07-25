-- Geocode cache: one row per unique address, lat/lng from Nominatim
CREATE TABLE IF NOT EXISTS sched_geocode_cache (
  address_hash TEXT PRIMARY KEY,       -- lowercase trimmed address as key
  address_original TEXT NOT NULL,       -- original address text
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geocoded_at TIMESTAMPTZ DEFAULT now(),
  source TEXT DEFAULT 'nominatim'
);

CREATE INDEX IF NOT EXISTS idx_geocode_address ON sched_geocode_cache(address_hash);
