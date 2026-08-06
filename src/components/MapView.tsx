"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useData } from "./DataProvider";
import { geocodeFastZip, geocodeBatch, GeoResult, GeoPrecision, clearAndReGeocode, manualCorrectGeocode } from "@/lib/geocode";
import { getRForceItemsForDay, typeLabel } from "@/lib/calendar-utils";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import { format } from "date-fns";
import { Loader2, ExternalLink, Navigation, MapPinOff, RefreshCw, Crosshair } from "lucide-react";

function crewMarkerIcon(color: string, label?: string | number, precision?: GeoPrecision): L.DivIcon {
  const isApproximate = precision === "zip" || precision === "unknown";
  const text = label != null ? `<span style="
    color:${isApproximate ? "#666" : "#fff"};font-size:12px;font-weight:700;
    line-height:28px;text-shadow:0 1px 2px rgba(0,0,0,${isApproximate ? "0.15" : "0.4"});
  ">${label}</span>` : "";
  const border = isApproximate
    ? `border:3px dashed ${color};background:${color}33`
    : `border:3px solid white;background:${color}`;
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

function precisionLabel(p?: GeoPrecision): string {
  switch (p) {
    case "rooftop": return "Exact";
    case "street": return "Street-level";
    case "zip": return "Zip code area (~2 mi)";
    default: return "Unknown accuracy";
  }
}

function MarkerWithPopup({
  item: m,
  order,
  onReGeocode,
  onCorrect,
}: {
  item: MapItem;
  order?: number;
  onReGeocode: () => Promise<void>;
  onCorrect: (lat: number, lng: number) => Promise<void>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [reGeocoding, setReGeocoding] = useState(false);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const isApprox = m.geo.precision === "zip" || m.geo.precision === "unknown";

  return (
    <Marker
      position={[m.geo.lat, m.geo.lng]}
      icon={crewMarkerIcon(m.crewColor, order, m.geo.precision)}
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

          {/* Precision badge */}
          <div className={`flex items-center gap-1 mt-1.5 text-[10px] ${
            isApprox ? "text-amber-600" : "text-green-600"
          }`}>
            {isApprox ? <MapPinOff size={10} /> : <Crosshair size={10} />}
            {precisionLabel(m.geo.precision)}
            {m.geo.manualOverride && <span className="text-blue-500">(manual)</span>}
          </div>

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
            {isApprox && !correcting && (
              <button
                onClick={async () => {
                  setReGeocoding(true);
                  await onReGeocode();
                  setReGeocoding(false);
                }}
                disabled={reGeocoding}
                className="text-xs text-amber-600 underline flex items-center gap-1 disabled:opacity-50"
              >
                {reGeocoding ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                Re-geocode
              </button>
            )}
          </div>

          {/* Manual correction */}
          {isApprox && !correcting && (
            <button
              onClick={() => {
                setLatInput(m.geo.lat.toFixed(6));
                setLngInput(m.geo.lng.toFixed(6));
                setCorrecting(true);
              }}
              className="text-[10px] text-gray-400 underline mt-1 block"
            >
              Set exact location...
            </button>
          )}
          {correcting && (
            <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200 space-y-1.5">
              <div className="text-[10px] font-medium text-gray-600">Enter coordinates:</div>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={latInput}
                  onChange={(e) => setLatInput(e.target.value)}
                  placeholder="Latitude"
                  className="text-xs border rounded px-1.5 py-0.5 w-24"
                />
                <input
                  type="text"
                  value={lngInput}
                  onChange={(e) => setLngInput(e.target.value)}
                  placeholder="Longitude"
                  className="text-xs border rounded px-1.5 py-0.5 w-24"
                />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={async () => {
                    const lat = parseFloat(latInput);
                    const lng = parseFloat(lngInput);
                    if (!isNaN(lat) && !isNaN(lng)) {
                      await onCorrect(lat, lng);
                      setCorrecting(false);
                    }
                  }}
                  className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={() => setCorrecting(false)}
                  className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
              <div className="text-[9px] text-gray-400">Tip: right-click on Google Maps → &quot;What&apos;s here?&quot; to get coordinates</div>
            </div>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

export default function MapView({ date }: Props) {
  const { crews, appointments, rforceOrders } = useData();
  const [geoCache, setGeoCache] = useState<Map<string, GeoResult>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refining, setRefining] = useState(false);
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
    setRefining(false);

    geocodeFastZip(allAddresses).then((fastResults) => {
      if (cancelled) return;
      setGeoCache(new Map(fastResults));
      setLoading(false);
      setRefining(true);

      geocodeBatch(allAddresses, (done, total) => {
        if (!cancelled) setProgress({ done, total });
      }).then((preciseResults) => {
        if (!cancelled) {
          setGeoCache((prev) => {
            const merged = new Map(prev);
            for (const [addr, geo] of preciseResults) {
              merged.set(addr, geo);
            }
            return merged;
          });
          setRefining(false);
        }
      });
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

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Loader2 size={32} className="animate-spin text-primary" />
        <div className="text-sm text-muted">
          Loading map...
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
      {refining && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg px-4 py-2 shadow-lg z-[1000] flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-amber-600" />
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Showing approximate locations — refining to exact addresses... {progress.done}/{progress.total}
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
                setGeoCache((prev) => {
                  const next = new Map(prev);
                  next.set(m.address, result);
                  return next;
                });
              }
            }}
            onCorrect={async (lat, lng) => {
              await manualCorrectGeocode(m.address, lat, lng);
              setGeoCache((prev) => {
                const next = new Map(prev);
                next.set(m.address, { lat, lng, precision: "rooftop", manualOverride: true });
                return next;
              });
            }}
          />
        ))}
      </MapContainer>

      {!refining && mapItems.length < totalItems && (
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
        {mapItems.some((m) => m.geo.precision === "zip" || m.geo.precision === "unknown") && (
          <>
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
