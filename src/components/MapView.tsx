"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useData } from "./DataProvider";
import { geocodeBatch, GeoResult } from "@/lib/geocode";
import { getAppointmentsForCrewAndDay, typeLabel } from "@/lib/calendar-utils";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import { Appointment, Crew } from "@/lib/types";
import { format } from "date-fns";
import { Loader2, ExternalLink, MapPin, Navigation } from "lucide-react";

function crewMarkerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${color};border:3px solid white;
      box-shadow:0 2px 6px rgba(0,0,0,0.3);
    "></div>`,
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

interface MarkerData {
  appointment: Appointment;
  crew: Crew;
  geo: GeoResult;
}

export default function MapView({ date }: Props) {
  const { crews, appointments } = useData();
  const [geoCache, setGeoCache] = useState<Map<string, GeoResult>>(new Map());
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const geocodingRef = useRef(false);

  const dateStr = format(date, "yyyy-MM-dd");

  const dayAppointments = useMemo(() => {
    return appointments.filter(
      (a) => a.scheduled_date === dateStr && a.status !== "cancelled"
    );
  }, [appointments, dateStr]);

  useEffect(() => {
    if (geocodingRef.current) return;
    const addresses = dayAppointments.map((a) => a.address).filter(Boolean);
    if (addresses.length === 0) {
      setLoading(false);
      return;
    }
    geocodingRef.current = true;
    setLoading(true);
    geocodeBatch(addresses, (done, total) => {
      setProgress({ done, total });
    }).then((results) => {
      setGeoCache(results);
      setLoading(false);
      geocodingRef.current = false;
    });
  }, [dateStr]);

  const markers: MarkerData[] = useMemo(() => {
    const result: MarkerData[] = [];
    for (const appt of dayAppointments) {
      const geo = geoCache.get(appt.address);
      const crew = crews.find((c) => c.id === appt.crew_id);
      if (geo && crew) {
        result.push({ appointment: appt, crew, geo });
      }
    }
    return result;
  }, [dayAppointments, geoCache, crews]);

  const positions: [number, number][] = markers.map((m) => [m.geo.lat, m.geo.lng]);

  const defaultCenter: [number, number] = [45.52, -122.68];

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 size={32} className="animate-spin text-primary" />
        <div className="text-sm text-muted">
          Geocoding addresses... {progress.done}/{progress.total}
        </div>
      </div>
    );
  }

  if (dayAppointments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        No appointments scheduled for this day.
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
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
        {markers.map((m) => (
          <Marker
            key={m.appointment.id}
            position={[m.geo.lat, m.geo.lng]}
            icon={crewMarkerIcon(m.crew.color)}
          >
            <Popup>
              <div className="text-sm min-w-[200px]">
                <div className="font-bold">{m.appointment.customer_name}</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {typeLabel(m.appointment.appointment_type)} &middot; {m.crew.name}
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                  <span>{m.appointment.address}</span>
                </div>
                {m.appointment.product_count && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {m.appointment.product_count} products
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <a
                    href={mapsHref(m.appointment.address)}
                    target="_blank"
                    rel="noopener"
                    className="text-xs text-blue-600 underline flex items-center gap-1"
                  >
                    <Navigation size={10} />
                    Directions
                  </a>
                  {m.appointment.work_order_number && (
                    <button
                      onClick={() =>
                        openSalesforce(
                          m.appointment.work_order_number!,
                          m.appointment.order_number || ""
                        )
                      }
                      className="text-xs text-blue-600 underline flex items-center gap-1"
                    >
                      <ExternalLink size={10} />
                      rForce
                    </button>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {markers.length < dayAppointments.length && (
        <div className="absolute bottom-4 left-4 bg-background/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs text-muted shadow-lg z-[1000]">
          Showing {markers.length} of {dayAppointments.length} appointments (some addresses could not be geocoded)
        </div>
      )}

      <div className="absolute top-3 right-3 bg-background/90 backdrop-blur border border-border rounded-lg p-2 shadow-lg z-[1000]">
        <div className="text-[10px] text-muted font-medium mb-1.5">Crews</div>
        <div className="space-y-1">
          {crews
            .filter((c) => markers.some((m) => m.crew.id === c.id))
            .map((c) => {
              const count = markers.filter((m) => m.crew.id === c.id).length;
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
      </div>
    </div>
  );
}
