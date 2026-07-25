"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useData } from "./DataProvider";
import { geocodeBatch, GeoResult } from "@/lib/geocode";
import { getRForceItemsForDay } from "@/lib/calendar-utils";
import { getAppointmentsForCrewAndDay } from "@/lib/calendar-utils";
import { mapsHref } from "@/lib/salesforce";
import { Crew } from "@/lib/types";
import { format } from "date-fns";
import { Loader2, Navigation } from "lucide-react";

function crewMarkerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${color};border:2px solid white;
      box-shadow:0 2px 4px rgba(0,0,0,0.3);
    "></div>`,
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
  geo: GeoResult;
}

export default function SectionMap({ date, crews }: Props) {
  const { appointments, rforceOrders } = useData();
  const [geoCache, setGeoCache] = useState<Map<string, GeoResult>>(new Map());
  const [loading, setLoading] = useState(true);

  const dateStr = format(date, "yyyy-MM-dd");
  const crewIds = useMemo(() => new Set(crews.map((c) => c.id)), [crews]);

  const dayAppointments = useMemo(() => {
    return appointments.filter(
      (a) => a.scheduled_date === dateStr && a.status !== "cancelled" && crewIds.has(a.crew_id)
    );
  }, [appointments, dateStr, crewIds]);

  const dayRForceItems = useMemo(
    () => getRForceItemsForDay(rforceOrders, appointments, crews, date).filter((r) => crewIds.has(r.crewId)),
    [rforceOrders, appointments, crews, date, crewIds]
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
    geocodeBatch(allAddresses).then((results) => {
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
          type: appt.appointment_type,
          crewName: crew.name,
          crewColor: crew.color,
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
          geo,
        });
      }
    }
    return items;
  }, [dayAppointments, dayRForceItems, geoCache, crews]);

  const positions: [number, number][] = mapItems.map((m) => [m.geo.lat, m.geo.lng]);
  const defaultCenter: [number, number] = [41.65, -83.54];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  if (mapItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-xs">
        No geocoded items
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
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
            icon={crewMarkerIcon(m.crewColor)}
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
