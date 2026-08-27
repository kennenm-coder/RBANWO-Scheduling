"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useData } from "./DataProvider";
import { crewColorFor } from "@/lib/preferences";
import {
  geocodeAddress,
  clearAndReGeocode,
  manualCorrectGeocode,
  geocodeForComparison,
  updateWorkOrderCoords,
  validateCoordinates,
  getCachedGeocode,
  GeoResult,
  GeoPrecision,
} from "@/lib/geocode";
import { getRForceItemsForDay, typeLabel, formatProductBreakdown, RForceCalendarItem } from "@/lib/calendar-utils";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import { Appointment, RForceOrder } from "@/lib/types";
import { format, parseISO, addDays } from "date-fns";
import {
  Loader2,
  ExternalLink,
  Navigation,
  MapPinOff,
  RefreshCw,
  Crosshair,
  Database,
  Globe,
  PenLine,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";

// ── Types ──

type GeoSource = "database" | "geocoded" | "manual";

interface MapItem {
  id: string;
  customerName: string;
  address: string;
  type: string;
  crewName: string;
  crewColor: string;
  crewId: string;
  productLabel?: string | null;
  workOrderNumber?: string | null;
  orderNumber?: string | null;
  isRForce: boolean;
  geo: GeoResult;
  geoSource: GeoSource;
}

interface VerifyResult {
  geocoded: GeoResult;
  distanceMeters: number;
}

// ── Utilities ──

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters: number): string {
  if (meters < 100) return `${Math.round(meters)}m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  const miles = meters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/**
 * Check if a given date falls within a multi-day appointment's span.
 * Issue #6: multi-day installations should appear on continuation days.
 */
function appointmentOverlapsDate(appt: Appointment, dateStr: string): boolean {
  if (!appt.scheduled_date || appt.status === "cancelled") return false;
  // Direct match
  if (appt.scheduled_date === dateStr) return true;
  // Multi-day: check if dateStr falls within the span
  if (appt.duration_days > 1) {
    const target = parseISO(dateStr);
    const start = parseISO(appt.scheduled_date);
    for (let d = 1; d < appt.duration_days; d++) {
      const spanned = addDays(start, d);
      if (
        spanned.getFullYear() === target.getFullYear() &&
        spanned.getMonth() === target.getMonth() &&
        spanned.getDate() === target.getDate()
      ) {
        return true;
      }
    }
  }
  return false;
}

function crewMarkerIcon(color: string, label?: string | number, precision?: GeoPrecision, source?: GeoSource): L.DivIcon {
  const isApproximate = precision === "zip" || precision === "unknown";
  const isManual = source === "manual";
  const text = label != null ? `<span style="
    color:${isApproximate ? "#666" : "#fff"};font-size:12px;font-weight:700;
    line-height:28px;text-shadow:0 1px 2px rgba(0,0,0,${isApproximate ? "0.15" : "0.4"});
  ">${label}</span>` : "";

  let border: string;
  if (isApproximate) {
    border = `border:3px dashed ${color};background:${color}33`;
  } else if (isManual) {
    border = `border:3px solid #3b82f6;background:${color}`;
  } else {
    border = `border:3px solid white;background:${color}`;
  }

  return L.divIcon({
    className: "",
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      ${border};
      box-shadow:0 2px 6px rgba(0,0,0,${isApproximate ? "0.15" : "0.3"});
      display:flex;align-items:center;justify-content:center;
    ">${text}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 12);
    } else {
      const bounds = L.latLngBounds(positions.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [map, positions]);
  return null;
}

interface Props {
  date: Date;
}

function precisionLabel(p?: GeoPrecision): string {
  switch (p) {
    case "rooftop": return "Exact";
    case "street": return "Street-level";
    case "zip": return "Zip code area (~2 mi)";
    default: return "Unknown accuracy";
  }
}

function sourceIcon(source: GeoSource) {
  switch (source) {
    case "database": return <Database size={10} />;
    case "geocoded": return <Globe size={10} />;
    case "manual": return <PenLine size={10} />;
  }
}

function sourceLabel(source: GeoSource): string {
  switch (source) {
    case "database": return "Database";
    case "geocoded": return "Geocoded";
    case "manual": return "Manual override";
  }
}

function sourceColor(source: GeoSource): string {
  switch (source) {
    case "database": return "text-emerald-600";
    case "geocoded": return "text-blue-600";
    case "manual": return "text-violet-600";
  }
}

// ── Marker popup with verify / correct / error flow ──

function MarkerWithPopup({
  item: m,
  order,
  onReGeocode,
  onCorrect,
  onAcceptVerified,
}: {
  item: MapItem;
  order?: number;
  onReGeocode: () => Promise<void>;
  onCorrect: (lat: number, lng: number) => Promise<{ ok: boolean; error?: string }>;
  onAcceptVerified: (geo: GeoResult) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [reGeocoding, setReGeocoding] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [acceptingVerified, setAcceptingVerified] = useState(false);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const isApprox = m.geo.precision === "zip" || m.geo.precision === "unknown";

  const showFeedback = useCallback((type: "success" | "error", msg: string) => {
    setFeedback({ type, msg });
    if (type === "success") setTimeout(() => setFeedback(null), 3000);
  }, []);

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyResult(null);
    const geocoded = await geocodeForComparison(m.address);
    if (geocoded) {
      const dist = haversineMeters(m.geo.lat, m.geo.lng, geocoded.lat, geocoded.lng);
      setVerifyResult({ geocoded, distanceMeters: dist });
    }
    setVerifying(false);
  }, [m.address, m.geo.lat, m.geo.lng]);

  const handleAcceptVerified = useCallback(async () => {
    if (!verifyResult) return;
    setAcceptingVerified(true);
    const result = await onAcceptVerified(verifyResult.geocoded);
    setVerifyResult(null);
    setAcceptingVerified(false);
    if (result.ok) {
      showFeedback("success", "Location updated & saved to database");
    } else {
      showFeedback("error", `Save failed: ${result.error || "Unknown error"}`);
    }
  }, [verifyResult, onAcceptVerified, showFeedback]);

  return (
    <Marker
      position={[m.geo.lat, m.geo.lng]}
      icon={crewMarkerIcon(m.crewColor, order, m.geo.precision, m.geoSource)}
    >
      <Popup>
        <div className="text-sm min-w-[220px] max-w-[300px]">
          {/* Header */}
          <div className="font-bold flex items-center gap-2">
            {m.customerName}
            {m.isRForce && (
              <span className="text-[9px] font-normal px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">rForce</span>
            )}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">
            {m.type} &middot; {m.crewName}
          </div>
          <div className="text-xs text-gray-500 mt-1">{m.address}</div>
          {m.productLabel && (
            <div className="text-xs text-gray-500 mt-0.5">{m.productLabel}</div>
          )}

          {/* Source + precision badges */}
          <div className="flex items-center gap-3 mt-2 py-1.5 px-2 bg-gray-50 rounded border border-gray-100">
            <div className={`flex items-center gap-1 text-[10px] ${sourceColor(m.geoSource)}`}>
              {sourceIcon(m.geoSource)}
              <span className="font-medium">{sourceLabel(m.geoSource)}</span>
            </div>
            <div className="text-gray-300">|</div>
            <div className={`flex items-center gap-1 text-[10px] ${
              isApprox ? "text-amber-600" : "text-green-600"
            }`}>
              {isApprox ? <MapPinOff size={10} /> : <Crosshair size={10} />}
              {precisionLabel(m.geo.precision)}
            </div>
          </div>

          {/* Coordinates */}
          <div className="text-[9px] text-gray-400 mt-1 font-mono">
            {m.geo.lat.toFixed(6)}, {m.geo.lng.toFixed(6)}
          </div>

          {/* Feedback (success or error) */}
          {feedback && (
            <div className={`flex items-center gap-1 mt-1.5 text-[10px] rounded px-2 py-1 ${
              feedback.type === "success"
                ? "text-green-600 bg-green-50"
                : "text-red-600 bg-red-50"
            }`}>
              {feedback.type === "success" ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
              {feedback.msg}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 mt-2 flex-wrap">
            <a
              href={mapsHref(m.address)}
              target="_blank"
              rel="noopener"
              className="text-xs text-blue-600 underline flex items-center gap-1"
            >
              <Navigation size={10} />
              Directions
            </a>
            {m.workOrderNumber && (
              <button
                onClick={() => openSalesforce(m.workOrderNumber!, m.orderNumber || "")}
                className="text-xs text-blue-600 underline flex items-center gap-1"
              >
                <ExternalLink size={10} />
                rForce
              </button>
            )}
          </div>

          {/* Location tools */}
          <div className="border-t border-gray-200 mt-2 pt-2">
            <div className="text-[10px] font-medium text-gray-500 mb-1.5">Location tools</div>
            <div className="flex gap-1.5 flex-wrap">
              {/* Verify button — compare database vs geocoder */}
              {(m.geoSource === "database" || m.geoSource === "manual") && !verifyResult && (
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className="text-[10px] px-2 py-1 bg-emerald-50 text-emerald-700 rounded border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 flex items-center gap-1"
                >
                  {verifying ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={10} />}
                  Verify with geocoder
                </button>
              )}

              {/* Re-geocode for geocoded items */}
              {m.geoSource === "geocoded" && !correcting && (
                <button
                  onClick={async () => {
                    setReGeocoding(true);
                    await onReGeocode();
                    setReGeocoding(false);
                  }}
                  disabled={reGeocoding}
                  className="text-[10px] px-2 py-1 bg-blue-50 text-blue-700 rounded border border-blue-200 hover:bg-blue-100 disabled:opacity-50 flex items-center gap-1"
                >
                  {reGeocoding ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Re-geocode
                </button>
              )}

              {/* Correct location — available on ALL pins */}
              {!correcting && (
                <button
                  onClick={() => {
                    setLatInput(m.geo.lat.toFixed(6));
                    setLngInput(m.geo.lng.toFixed(6));
                    setCorrecting(true);
                    setVerifyResult(null);
                    setFeedback(null);
                  }}
                  className="text-[10px] px-2 py-1 bg-gray-100 text-gray-700 rounded border border-gray-200 hover:bg-gray-200 flex items-center gap-1"
                >
                  <PenLine size={10} />
                  Correct location
                </button>
              )}
            </div>
          </div>

          {/* Verify result panel */}
          {verifyResult && !correcting && (
            <div className={`mt-2 p-2 rounded border ${
              verifyResult.distanceMeters < 100
                ? "bg-green-50 border-green-200"
                : verifyResult.distanceMeters < 500
                  ? "bg-amber-50 border-amber-200"
                  : "bg-red-50 border-red-200"
            }`}>
              <div className="flex items-center gap-1.5 mb-1.5">
                {verifyResult.distanceMeters < 100 ? (
                  <>
                    <CheckCircle2 size={12} className="text-green-600" />
                    <span className="text-[11px] font-medium text-green-700">Match — coordinates agree</span>
                  </>
                ) : verifyResult.distanceMeters < 500 ? (
                  <>
                    <AlertTriangle size={12} className="text-amber-600" />
                    <span className="text-[11px] font-medium text-amber-700">
                      Minor difference — {formatDistance(verifyResult.distanceMeters)} apart
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldAlert size={12} className="text-red-600" />
                    <span className="text-[11px] font-medium text-red-700">
                      Mismatch — {formatDistance(verifyResult.distanceMeters)} apart
                    </span>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
                <div>
                  <div className="text-gray-500 font-sans mb-0.5">Database</div>
                  <div className="text-emerald-700">{m.geo.lat.toFixed(6)}, {m.geo.lng.toFixed(6)}</div>
                </div>
                <div>
                  <div className="text-gray-500 font-sans mb-0.5">Geocoder</div>
                  <div className="text-blue-700">{verifyResult.geocoded.lat.toFixed(6)}, {verifyResult.geocoded.lng.toFixed(6)}</div>
                </div>
              </div>

              {verifyResult.distanceMeters >= 100 && (
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={handleAcceptVerified}
                    disabled={acceptingVerified}
                    className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    {acceptingVerified ? <Loader2 size={10} className="animate-spin" /> : <Globe size={10} />}
                    Use geocoder result
                  </button>
                  <button
                    onClick={() => setVerifyResult(null)}
                    className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    Keep database
                  </button>
                  <button
                    onClick={() => {
                      setLatInput(m.geo.lat.toFixed(6));
                      setLngInput(m.geo.lng.toFixed(6));
                      setCorrecting(true);
                      setVerifyResult(null);
                    }}
                    className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 flex items-center gap-1"
                  >
                    <PenLine size={10} />
                    Enter manually
                  </button>
                </div>
              )}

              {verifyResult.distanceMeters < 100 && (
                <button
                  onClick={() => setVerifyResult(null)}
                  className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200 mt-1.5"
                >
                  OK, dismiss
                </button>
              )}
            </div>
          )}

          {/* Manual correction panel */}
          {correcting && (
            <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200 space-y-1.5">
              <div className="text-[10px] font-medium text-gray-600">Enter exact coordinates:</div>
              <div className="flex gap-1">
                <div className="flex-1">
                  <label className="text-[9px] text-gray-400 block mb-0.5">Latitude</label>
                  <input
                    type="text"
                    value={latInput}
                    onChange={(e) => setLatInput(e.target.value)}
                    placeholder="41.653200"
                    className="text-xs border rounded px-1.5 py-1 w-full font-mono"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[9px] text-gray-400 block mb-0.5">Longitude</label>
                  <input
                    type="text"
                    value={lngInput}
                    onChange={(e) => setLngInput(e.target.value)}
                    placeholder="-83.540000"
                    className="text-xs border rounded px-1.5 py-1 w-full font-mono"
                  />
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={async () => {
                    const lat = parseFloat(latInput);
                    const lng = parseFloat(lngInput);
                    if (isNaN(lat) || isNaN(lng)) {
                      showFeedback("error", "Enter valid numbers");
                      return;
                    }
                    // Validate before saving
                    const check = validateCoordinates(lat, lng, m.address);
                    if (!check.valid) {
                      showFeedback("error", check.reason || "Invalid coordinates");
                      return;
                    }
                    const result = await onCorrect(lat, lng);
                    setCorrecting(false);
                    if (result.ok) {
                      showFeedback("success", "Location updated & saved to database");
                    } else {
                      showFeedback("error", `Save failed: ${result.error || "Unknown error"}`);
                    }
                  }}
                  className="text-[10px] px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                >
                  <CheckCircle2 size={10} />
                  Save to database
                </button>
                <button
                  onClick={() => setCorrecting(false)}
                  className="text-[10px] px-2.5 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
              <div className="text-[9px] text-gray-400 leading-tight">
                Tip: right-click on Google Maps → &quot;What&apos;s here?&quot; to get coordinates.
                This updates the work order in the database so future loads use the corrected location.
              </div>
            </div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

// ── Helpers to extract pre-computed coordinates ──

/**
 * Build a GeoResult from a work order's latitude/longitude.
 * Issue #2: Validates coordinates against service-area bounds
 * and the address's state before accepting them as "rooftop".
 * Returns null if coordinates are missing or fail validation.
 */
function geoFromOrder(order: RForceOrder): GeoResult | null {
  if (order.latitude == null || order.longitude == null) return null;

  const check = validateCoordinates(order.latitude, order.longitude, order.address);
  if (!check.valid) {
    // Invalid coordinates — fall through to geocoding
    return null;
  }

  return { lat: order.latitude, lng: order.longitude, precision: "rooftop" };
}

/**
 * Find the linked rForce order for an appointment (by work_order_number)
 * and return its pre-computed coordinates if available and valid.
 */
function geoFromLinkedOrder(
  appt: Appointment,
  rforceOrders: RForceOrder[]
): GeoResult | null {
  if (!appt.work_order_number) return null;
  const rf = rforceOrders.find((r) => r.work_order_number === appt.work_order_number);
  return rf ? geoFromOrder(rf) : null;
}

/**
 * Issue #5: Check the geocode cache for provenance.
 * If the address has a manual_override entry whose coordinates match,
 * we know a user corrected it (even though it now comes from the database).
 */
async function detectProvenance(
  address: string,
  dbLat: number,
  dbLng: number,
): Promise<GeoSource> {
  try {
    const cached = await getCachedGeocode(address);
    if (cached?.manualOverride) {
      // If the cached manual coords are very close to the DB coords,
      // the DB was updated from a manual correction
      const dist = haversineMeters(dbLat, dbLng, cached.lat, cached.lng);
      if (dist < 10) return "manual";
    }
  } catch {
    // Cache lookup failed — default to database
  }
  return "database";
}

// ── Main component ──

export default function MapView({ date }: Props) {
  const { crews, appointments, rforceOrders } = useData();
  const [geocodedExtras, setGeocodedExtras] = useState<Map<string, GeoResult>>(new Map());
  const [overrides, setOverrides] = useState<Map<string, { geo: GeoResult; source: GeoSource }>>(new Map());
  const [provenanceMap, setProvenanceMap] = useState<Map<string, GeoSource>>(new Map());
  const [geocodingCount, setGeocodingCount] = useState(0);

  const dateStr = format(date, "yyyy-MM-dd");

  // Issue #6: Include multi-day appointments that span into this date
  const dayAppointments = useMemo(() => {
    return appointments.filter((a) => appointmentOverlapsDate(a, dateStr));
  }, [appointments, dateStr]);

  const dayRForceItems = useMemo(
    () => getRForceItemsForDay(rforceOrders, appointments, crews, date),
    [rforceOrders, appointments, crews, date]
  );

  // ── Phase 1: Build map items from pre-computed coordinates ──

  const { instantItems, needsGeocoding } = useMemo(() => {
    const instant: MapItem[] = [];
    const needsGeo: { id: string; address: string; appt?: Appointment; rf?: RForceCalendarItem }[] = [];

    for (const appt of dayAppointments) {
      const crew = crews.find((c) => c.id === appt.crew_id);
      if (!crew || !appt.address) continue;

      const geo = geoFromLinkedOrder(appt, rforceOrders);
      if (geo) {
        instant.push({
          id: appt.id,
          customerName: appt.customer_name,
          address: appt.address,
          type: typeLabel(appt.appointment_type),
          crewName: crew.name,
          crewColor: crewColorFor(crew),
          crewId: crew.id,
          productLabel: formatProductBreakdown(appt),
          workOrderNumber: appt.work_order_number,
          orderNumber: appt.order_number,
          isRForce: false,
          geo,
          geoSource: "database",
        });
      } else {
        needsGeo.push({ id: appt.id, address: appt.address, appt });
      }
    }

    for (const rf of dayRForceItems) {
      const crew = crews.find((c) => c.id === rf.crewId);
      if (!crew) continue;

      const geo = geoFromOrder(rf.rforceOrder);
      if (geo) {
        instant.push({
          id: rf.rforceOrder.work_order_number,
          customerName: rf.rforceOrder.customer_name || "Unknown",
          address: rf.rforceOrder.address || "",
          type: rf.rforceOrder.work_order_type || "Unknown",
          crewName: crew.name,
          crewColor: crewColorFor(crew),
          crewId: crew.id,
          productLabel: formatProductBreakdown(rf.rforceOrder),
          workOrderNumber: rf.rforceOrder.work_order_number,
          orderNumber: rf.rforceOrder.order_number,
          isRForce: true,
          geo,
          geoSource: "database",
        });
      } else if (rf.rforceOrder.address) {
        needsGeo.push({ id: rf.rforceOrder.work_order_number, address: rf.rforceOrder.address, rf });
      }
    }

    return { instantItems: instant, needsGeocoding: needsGeo };
  }, [dayAppointments, dayRForceItems, rforceOrders, crews]);

  // Issue #5: Detect provenance for database-sourced items
  useEffect(() => {
    if (instantItems.length === 0) return;
    let cancelled = false;

    (async () => {
      const results = new Map<string, GeoSource>();
      for (const item of instantItems) {
        if (cancelled) break;
        if (item.geoSource !== "database") continue;
        const prov = await detectProvenance(item.address, item.geo.lat, item.geo.lng);
        if (prov !== "database") results.set(item.id, prov);
      }
      if (!cancelled && results.size > 0) {
        setProvenanceMap(results);
      }
    })();

    return () => { cancelled = true; };
  }, [instantItems]);

  // ── Phase 2: Background-geocode items missing coordinates ──

  useEffect(() => {
    if (needsGeocoding.length === 0) return;
    let cancelled = false;
    setGeocodingCount(needsGeocoding.length);

    (async () => {
      for (const item of needsGeocoding) {
        if (cancelled) break;
        const geo = await geocodeAddress(item.address);
        if (geo && !cancelled) {
          setGeocodedExtras((prev) => {
            const next = new Map(prev);
            next.set(item.id, geo);
            return next;
          });
        }
      }
      if (!cancelled) setGeocodingCount(0);
    })();

    return () => { cancelled = true; };
  }, [dateStr, needsGeocoding]);

  // ── Merge all sources, applying overrides and provenance ──

  const mapItems: MapItem[] = useMemo(() => {
    const items = instantItems.map((m) => {
      const ov = overrides.get(m.id);
      if (ov) return { ...m, geo: ov.geo, geoSource: ov.source };
      // Apply detected provenance
      const prov = provenanceMap.get(m.id);
      if (prov) return { ...m, geoSource: prov };
      return m;
    });

    for (const item of needsGeocoding) {
      const ov = overrides.get(item.id);
      const geo = ov?.geo ?? geocodedExtras.get(item.id);
      const source: GeoSource = ov?.source ?? "geocoded";
      if (!geo) continue;

      if (item.appt) {
        const crew = crews.find((c) => c.id === item.appt!.crew_id);
        if (!crew) continue;
        items.push({
          id: item.appt.id,
          customerName: item.appt.customer_name,
          address: item.appt.address,
          type: typeLabel(item.appt.appointment_type),
          crewName: crew.name,
          crewColor: crewColorFor(crew),
          crewId: crew.id,
          productLabel: formatProductBreakdown(item.appt),
          workOrderNumber: item.appt.work_order_number,
          orderNumber: item.appt.order_number,
          isRForce: false,
          geo,
          geoSource: source,
        });
      } else if (item.rf) {
        const crew = crews.find((c) => c.id === item.rf!.crewId);
        if (!crew) continue;
        items.push({
          id: item.rf.rforceOrder.work_order_number,
          customerName: item.rf.rforceOrder.customer_name || "Unknown",
          address: item.rf.rforceOrder.address || "",
          type: item.rf.rforceOrder.work_order_type || "Unknown",
          crewName: crew.name,
          crewColor: crewColorFor(crew),
          crewId: crew.id,
          productLabel: formatProductBreakdown(item.rf.rforceOrder),
          workOrderNumber: item.rf.rforceOrder.work_order_number,
          orderNumber: item.rf.rforceOrder.order_number,
          isRForce: true,
          geo,
          geoSource: source,
        });
      }
    }
    return items;
  }, [instantItems, needsGeocoding, geocodedExtras, overrides, provenanceMap, crews]);

  const crewOrder = useMemo(() => {
    const order = new Map<string, number>();
    const counters = new Map<string, number>();
    for (const m of mapItems) {
      const count = (counters.get(m.crewId) || 0) + 1;
      counters.set(m.crewId, count);
      order.set(m.id, count);
    }
    return order;
  }, [mapItems]);

  const positions: [number, number][] = mapItems.map((m) => [m.geo.lat, m.geo.lng]);
  const totalItems = dayAppointments.length + dayRForceItems.length;
  const defaultCenter: [number, number] = [41.65, -83.54];

  const sourceStats = useMemo(() => {
    const stats = { database: 0, geocoded: 0, manual: 0 };
    for (const m of mapItems) stats[m.geoSource]++;
    return stats;
  }, [mapItems]);

  // ── Save handlers with error propagation (Issue #4) ──

  const handleCorrect = useCallback(
    async (itemId: string, address: string, workOrderNumber: string | null, lat: number, lng: number): Promise<{ ok: boolean; error?: string }> => {
      const cacheResult = await manualCorrectGeocode(address, lat, lng);
      if (!cacheResult.ok) return cacheResult;

      if (workOrderNumber) {
        const dbResult = await updateWorkOrderCoords(workOrderNumber, lat, lng);
        if (!dbResult.ok) return dbResult;
      }

      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(itemId, {
          geo: { lat, lng, precision: "rooftop", manualOverride: true },
          source: "manual",
        });
        return next;
      });
      return { ok: true };
    },
    []
  );

  const handleAcceptVerified = useCallback(
    async (itemId: string, address: string, workOrderNumber: string | null, geo: GeoResult): Promise<{ ok: boolean; error?: string }> => {
      const cacheResult = await manualCorrectGeocode(address, geo.lat, geo.lng);
      if (!cacheResult.ok) return cacheResult;

      if (workOrderNumber) {
        const dbResult = await updateWorkOrderCoords(workOrderNumber, geo.lat, geo.lng);
        if (!dbResult.ok) return dbResult;
      }

      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(itemId, { geo: { ...geo, precision: "rooftop" }, source: "manual" });
        return next;
      });
      return { ok: true };
    },
    []
  );

  if (totalItems === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        No appointments scheduled for this day.
      </div>
    );
  }

  if (instantItems.length === 0 && geocodingCount > 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 size={32} className="animate-spin text-primary" />
        <div className="text-sm text-muted">Locating addresses...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      {geocodingCount > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded-lg px-4 py-2 shadow-lg z-[1000] flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-blue-600" />
          <span className="text-xs text-blue-700 dark:text-blue-300">
            Geocoding {geocodingCount} address{geocodingCount !== 1 ? "es" : ""} without coordinates...
          </span>
        </div>
      )}

      <MapContainer
        center={positions.length > 0 ? positions[0] : defaultCenter}
        zoom={11}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds positions={positions} />
        {mapItems.map((m) => (
          <MarkerWithPopup
            key={m.id}
            item={m}
            order={crewOrder.get(m.id)}
            onReGeocode={async () => {
              const result = await clearAndReGeocode(m.address);
              if (result) {
                setOverrides((prev) => {
                  const next = new Map(prev);
                  next.set(m.id, { geo: result, source: "geocoded" });
                  return next;
                });
              }
            }}
            onCorrect={(lat, lng) =>
              handleCorrect(m.id, m.address, m.workOrderNumber ?? null, lat, lng)
            }
            onAcceptVerified={(geo) =>
              handleAcceptVerified(m.id, m.address, m.workOrderNumber ?? null, geo)
            }
          />
        ))}
      </MapContainer>

      {geocodingCount === 0 && mapItems.length < totalItems && (
        <div className="absolute bottom-4 left-4 bg-background/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs text-muted shadow-lg z-[1000]">
          Showing {mapItems.length} of {totalItems} items (some addresses could not be located)
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-3 right-3 bg-background/90 backdrop-blur border border-border rounded-lg p-2 shadow-lg z-[1000]">
        <div className="text-[10px] text-muted font-medium mb-1.5">Crews</div>
        <div className="space-y-1">
          {crews
            .filter((c) => mapItems.some((m) => m.crewId === c.id))
            .map((c) => {
              const count = mapItems.filter((m) => m.crewId === c.id).length;
              return (
                <div key={c.id} className="flex items-center gap-1.5 text-[10px]">
                  <div
                    className="w-3 h-3 rounded-full shrink-0 border border-white shadow-sm"
                    style={{ backgroundColor: c.color }}
                  />
                  <span>{c.name}</span>
                  <span className="text-muted">({count})</span>
                </div>
              );
            })}
        </div>

        {/* Source breakdown */}
        <div className="border-t border-border mt-1.5 pt-1.5">
          <div className="text-[10px] text-muted font-medium mb-1">Pin source</div>
          {sourceStats.database > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
              <Database size={9} />
              <span>Database ({sourceStats.database})</span>
            </div>
          )}
          {sourceStats.geocoded > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-blue-600 mt-0.5">
              <Globe size={9} />
              <span>Geocoded ({sourceStats.geocoded})</span>
            </div>
          )}
          {sourceStats.manual > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-violet-600 mt-0.5">
              <PenLine size={9} />
              <span>Manual ({sourceStats.manual})</span>
            </div>
          )}
        </div>

        {/* Accuracy legend */}
        {mapItems.some((m) => m.geo.precision === "zip" || m.geo.precision === "unknown") && (
          <div className="border-t border-border mt-1.5 pt-1.5">
            <div className="text-[10px] text-muted font-medium mb-1">Accuracy</div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <div className="w-3 h-3 rounded-full shrink-0 bg-gray-500 border-2 border-white shadow-sm" />
              <span>Exact</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
              <div className="w-3 h-3 rounded-full shrink-0 border-2 border-dashed border-gray-400" />
              <span className="text-amber-600">Approximate</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
              <div className="w-3 h-3 rounded-full shrink-0 bg-gray-500 border-2 border-blue-500 shadow-sm" />
              <span className="text-blue-600">Manual override</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
