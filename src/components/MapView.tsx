"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useData } from "./DataProvider";
import { geocodeBatch, GeoResult } from "@/lib/geocode";
import { getRForceItemsForDay, typeLabel } from "@/lib/calendar-utils";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import { Appointment, Crew, RForceOrder } from "@/lib/types";
import { format } from "date-fns";
import { Loader2, ExternalLink, Navigation } from "lucide-react";

function crewMarkerIcon(color: string, dashed?: boolean): L.DivIcon {
  const border = dashed
    ? `border:3px dashed white;`
    : `border:3px solid white;`;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${color};${border}
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

interface MapItem {
  id: string;
  customerName: string;
  address: string;
  type: string;
  crewName: string;
  crewColor: string;
  crewId: string;
  productCount?: number | null;
  workOrderNumber?: string | null;
  orderNumber?: string | null;
  isRForce: boolean;
  geo: GeoResult;
}

export default function MapView({ date }: Props) {
  const { crews, appointments, rforceOrders } = useData();
  const [geoCache, setGeoCache] = useState<Map<string, GeoResult>>(new Map());
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const dateStr = format(date, "yyyy-MM-dd");

  const dayAppointments = useMemo(() => {
    return appointments.filter(
      (a) => a.scheduled_date === dateStr && a.status !== "cancelled"
    );
  }, [appointments, dateStr]);

  const dayRForceItems = useMemo(
    () => getRForceItemsForDay(rforceOrders, appointments, crews, date),
    [rforceOrders, appointments, crews, date]
  );

  const allAddresses = useMemo(() => {
    const addrs: string[] = [];
    for (const a of dayAppointments) {
      if (a.address) addrs.push(a.address);
    }
    for (const rf of dayRForceItems) {
      if (rf.rforceOrder.address) addrs.push(rf.rforceOrder.address);
    }
    return [...new Set(addrs)];
  }, [dayAppointments, dayRForceItems]);

  useEffect(() => {
    if (allAddresses.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    geocodeBatch(allAddresses, (done, total) => {
      if (!cancelled) setProgress({ done, total });
    }).then((results) => {
      if (!cancelled) {
        setGeoCache(results);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [dateStr, allAddresses]);

  const mapItems: MapItem[] = useMemo(() => {
    const items: MapItem[] = [];
    for (const appt of dayAppointments) {
      const geo = geoCache.get(appt.address);
      const crew = crews.find((c) => c.id === appt.crew_id);
      if (geo && crew) {
        items.push({
          id: appt.id,
          customerName: appt.customer_name,
          address: appt.address,
          type: typeLabel(appt.appointment_type),
          crewName: crew.name,
          crewColor: crew.color,
          crewId: crew.id,
          productCount: appt.product_count,
          workOrderNumber: appt.work_order_number,
          orderNumber: appt.order_number,
          isRForce: false,
          geo,
        });
      }
    }
    for (const rf of dayRForceItems) {
      const geo = geoCache.get(rf.rforceOrder.address || "");
      const crew = crews.find((c) => c.id === rf.crewId);
      if (geo && crew) {
        items.push({
          id: rf.rforceOrder.work_order_number,
          customerName: rf.rforceOrder.customer_name || "Unknown",
          address: rf.rforceOrder.address || "",
          type: rf.rforceOrder.work_order_type || "Unknown",
          crewName: crew.name,
          crewColor: crew.color,
          crewId: crew.id,
          productCount: rf.rforceOrder.product_count,
          workOrderNumber: rf.rforceOrder.work_order_number,
          orderNumber: rf.rforceOrder.order_number,
          isRForce: true,
          geo,
        });
      }
    }
    return items;
  }, [dayAppointments, dayRForceItems, geoCache, crews]);

  const positions: [number, number][] = mapItems.map((m) => [m.geo.lat, m.geo.lng]);
  const totalItems = dayAppointments.length + dayRForceItems.length;

  const defaultCenter: [number, number] = [41.65, -83.54];

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

  if (totalItems === 0) {
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
        {mapItems.map((m) => (
          <Marker
            key={m.id}
            position={[m.geo.lat, m.geo.lng]}
            icon={crewMarkerIcon(m.crewColor, false)}
          >
            <Popup>
              <div className="text-sm min-w-[200px]">
                <div className="font-bold flex items-center gap-2">
                  {m.customerName}
                  {m.isRForce && (
                    <span className="text-[9px] font-normal px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">rForce</span>
                  )}
                </div>
                <div className="text-xs text-gray-600 mt-0.5">
                  {m.type} &middot; {m.crewName}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {m.address}
                </div>
                {m.productCount != null && m.productCount > 0 && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {m.productCount} products
                  </div>
                )}
                <div className="flex gap-2 mt-2">
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
                      onClick={() =>
                        openSalesforce(m.workOrderNumber!, m.orderNumber || "")
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

      {mapItems.length < totalItems && (
        <div className="absolute bottom-4 left-4 bg-background/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs text-muted shadow-lg z-[1000]">
          Showing {mapItems.length} of {totalItems} items (some addresses could not be geocoded)
        </div>
      )}

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
      </div>
    </div>
  );
}
