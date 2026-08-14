"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useData } from "./DataProvider";
import { geocodeAddress, validateCoordinates, GeoResult, GeoPrecision } from "@/lib/geocode";
import { getRForceItemsForDay } from "@/lib/calendar-utils";
import { mapsHref } from "@/lib/salesforce";
import { Appointment, Crew, RForceOrder } from "@/lib/types";
import { format, parseISO, addDays } from "date-fns";
import { Loader2, Navigation } from "lucide-react";

function crewMarkerIcon(color: string, label?: string | number, precision?: GeoPrecision): L.DivIcon {
  const isApproximate = precision === "zip" || precision === "unknown";
  const text = label != null ? `<span style="
    color:${isApproximate ? "#666" : "#fff"};font-size:10px;font-weight:700;
    line-height:22px;text-shadow:0 1px 2px rgba(0,0,0,${isApproximate ? "0.15" : "0.4"});
  ">${label}</span>` : "";
  const border = isApproximate
    ? `border:2px dashed ${color};background:${color}33`
    : `border:2px solid white;background:${color}`;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      ${border};
      box-shadow:0 2px 4px rgba(0,0,0,${isApproximate ? "0.15" : "0.3"});
      display:flex;align-items:center;justify-content:center;
    ">${text}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 11);
    } else {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [map, positions]);
  return null;
}

interface Props {
  date: Date;
  crews: Crew[];
}

interface MapItem {
  id: string;
  customerName: string;
  address: string;
  type: string;
  crewName: string;
  crewColor: string;
  crewId: string;
  geo: GeoResult;
}

/** Same multi-day check as MapView — appointments span into continuation days */
function appointmentOverlapsDate(appt: Appointment, dateStr: string): boolean {
  if (!appt.scheduled_date || appt.status === "cancelled") return false;
  if (appt.scheduled_date === dateStr) return true;
  if (appt.duration_days > 1) {
    const target = parseISO(dateStr);
    const start = parseISO(appt.scheduled_date);
    for (let d = 1; d < appt.duration_days; d++) {
      const spanned = addDays(start, d);
      if (
        spanned.getFullYear() === target.getFullYear() &&
        spanned.getMonth() === target.getMonth() &&
        spanned.getDate() === target.getDate()
      ) return true;
    }
  }
  return false;
}

/** Validated geo from pre-computed coordinates — same as MapView */
function geoFromOrder(order: RForceOrder): GeoResult | null {
  if (order.latitude == null || order.longitude == null) return null;
  const check = validateCoordinates(order.latitude, order.longitude, order.address);
  if (!check.valid) return null;
  return { lat: order.latitude, lng: order.longitude, precision: "rooftop" };
}

export default function SectionMap({ date, crews }: Props) {
  const { appointments, rforceOrders } = useData();
  const [geocodedExtras, setGeocodedExtras] = useState<Map<string, GeoResult>>(new Map());
  const [geocodingCount, setGeocodingCount] = useState(0);

  const dateStr = format(date, "yyyy-MM-dd");
  const crewIds = useMemo(() => new Set(crews.map((c) => c.id)), [crews]);

  const dayAppointments = useMemo(() => {
    return appointments.filter(
      (a) => appointmentOverlapsDate(a, dateStr) && a.crew_id != null && crewIds.has(a.crew_id)
    );
  }, [appointments, dateStr, crewIds]);

  const dayRForceItems = useMemo(
    () => getRForceItemsForDay(rforceOrders, appointments, crews, date).filter((r) => crewIds.has(r.crewId)),
    [rforceOrders, appointments, crews, date, crewIds]
  );

  // Phase 1: instant items from database coordinates
  const { instantItems, needsGeocoding } = useMemo(() => {
    const instant: MapItem[] = [];
    const needsGeo: { id: string; address: string }[] = [];

    for (const appt of dayAppointments) {
      const crew = crews.find((c) => c.id === appt.crew_id);
      if (!crew || !appt.address) continue;

      // Try linked rForce order coordinates
      let geo: GeoResult | null = null;
      if (appt.work_order_number) {
        const rf = rforceOrders.find((r) => r.work_order_number === appt.work_order_number);
        if (rf) geo = geoFromOrder(rf);
      }

      if (geo) {
        instant.push({
          id: appt.id,
          customerName: appt.customer_name,
          address: appt.address,
          type: appt.appointment_type,
          crewName: crew.name,
          crewColor: crew.color,
          crewId: crew.id,
          geo,
        });
      } else {
        needsGeo.push({ id: appt.id, address: appt.address });
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
          crewColor: crew.color,
          crewId: crew.id,
          geo,
        });
      } else if (rf.rforceOrder.address) {
        needsGeo.push({ id: rf.rforceOrder.work_order_number, address: rf.rforceOrder.address });
      }
    }

    return { instantItems: instant, needsGeocoding: needsGeo };
  }, [dayAppointments, dayRForceItems, rforceOrders, crews]);

  // Phase 2: background geocode the rest
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

  // Merge
  const mapItems: MapItem[] = useMemo(() => {
    const items = [...instantItems];
    for (const item of needsGeocoding) {
      const geo = geocodedExtras.get(item.id);
      if (!geo) continue;
      // Find the original appointment or rForce item to build a full MapItem
      const appt = dayAppointments.find((a) => a.id === item.id);
      if (appt) {
        const crew = crews.find((c) => c.id === appt.crew_id);
        if (crew) {
          items.push({
            id: appt.id,
            customerName: appt.customer_name,
            address: appt.address,
            type: appt.appointment_type,
            crewName: crew.name,
            crewColor: crew.color,
            crewId: crew.id,
            geo,
          });
        }
      } else {
        const rf = dayRForceItems.find((r) => r.rforceOrder.work_order_number === item.id);
        if (rf) {
          const crew = crews.find((c) => c.id === rf.crewId);
          if (crew) {
            items.push({
              id: rf.rforceOrder.work_order_number,
              customerName: rf.rforceOrder.customer_name || "Unknown",
              address: rf.rforceOrder.address || "",
              type: rf.rforceOrder.work_order_type || "Unknown",
              crewName: crew.name,
              crewColor: crew.color,
              crewId: crew.id,
              geo,
            });
          }
        }
      }
    }
    return items;
  }, [instantItems, needsGeocoding, geocodedExtras, dayAppointments, dayRForceItems, crews]);

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
  const defaultCenter: [number, number] = [41.65, -83.54];

  if (instantItems.length === 0 && geocodingCount > 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  if (mapItems.length === 0 && geocodingCount === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-xs">
        No geocoded items
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {geocodingCount > 0 && (
        <div className="absolute top-1 left-1 right-1 bg-blue-50/90 dark:bg-blue-900/40 border border-blue-300/60 dark:border-blue-700/50 rounded px-2 py-1 z-[1000] flex items-center gap-1.5">
          <Loader2 size={10} className="animate-spin text-blue-600" />
          <span className="text-[9px] text-blue-700 dark:text-blue-300">
            Geocoding {geocodingCount} address{geocodingCount !== 1 ? "es" : ""}...
          </span>
        </div>
      )}
      <MapContainer
        center={positions.length > 0 ? positions[0] : defaultCenter}
        zoom={10}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds positions={positions} />
        {mapItems.map((m) => (
          <Marker
            key={m.id}
            position={[m.geo.lat, m.geo.lng]}
            icon={crewMarkerIcon(m.crewColor, crewOrder.get(m.id), m.geo.precision)}
          >
            <Popup>
              <div className="text-xs min-w-[160px]">
                <div className="font-bold">{m.customerName}</div>
                <div className="text-gray-600 mt-0.5">{m.type} &middot; {m.crewName}</div>
                <div className="text-gray-500 mt-0.5">{m.address}</div>
                <a
                  href={mapsHref(m.address)}
                  target="_blank"
                  rel="noopener"
                  className="text-blue-600 underline flex items-center gap-1 mt-1"
                >
                  <Navigation size={9} />
                  Directions
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
