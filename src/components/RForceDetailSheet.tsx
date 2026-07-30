"use client";

import { useState } from "react";
import { RForceOrder, Crew } from "@/lib/types";
import { openSalesforce, mapsHref } from "@/lib/salesforce";
import { parseCity } from "@/lib/crew-utils";
import ScheduleModal from "./ScheduleModal";
import {
  X,
  MapPin,
  ExternalLink,
  Calendar,
  Hash,
  User,
  Phone,
  Package,
  Link2,
} from "lucide-react";

interface Props {
  order: RForceOrder;
  crew?: Crew;
  onClose: () => void;
}

export default function RForceDetailSheet({ order, crew, onClose }: Props) {
  const [scheduling, setScheduling] = useState(false);

  const city = parseCity(order.address || "");

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-background rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto animate-slide-up safe-area-bottom">
          <div className="sticky top-0 bg-background p-4 flex items-center justify-between border-b border-border z-10">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">rForce Order</h2>
              <span className="text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200 px-2 py-0.5 rounded-full font-medium">
                Imported from rForce — not yet linked
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-full hover:bg-surface"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <div className="text-xl font-bold">
                {order.customer_name || "Unknown Customer"}
              </div>
              {order.work_order_type && (
                <span
                  className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white mt-1"
                  style={{ backgroundColor: crew?.color || "#888" }}
                >
                  {order.work_order_type}
                </span>
              )}
            </div>

            {crew && (
              <InfoRow icon={<User size={16} />} label="Assigned Resource">
                {crew.name}
              </InfoRow>
            )}

            {order.scheduled_start && (
              <InfoRow icon={<Calendar size={16} />} label="Scheduled">
                {order.scheduled_start.slice(0, 10)}
                {order.scheduled_end &&
                  order.scheduled_end.slice(0, 10) !== order.scheduled_start.slice(0, 10) &&
                  ` – ${order.scheduled_end.slice(0, 10)}`}
              </InfoRow>
            )}

            {order.address && (
              <InfoRow icon={<MapPin size={16} />} label="Address">
                <a
                  href={mapsHref(order.address)}
                  target="_blank"
                  rel="noopener"
                  className="text-primary underline"
                >
                  {order.address}
                </a>
              </InfoRow>
            )}

            <InfoRow icon={<Hash size={16} />} label="Work Order">
              {order.work_order_number}
            </InfoRow>

            <InfoRow icon={<Hash size={16} />} label="Order">
              {order.order_number}
            </InfoRow>

            {order.wo_status && (
              <InfoRow icon={<Hash size={16} />} label="WO Status">
                {order.wo_status}
              </InfoRow>
            )}

            {order.product_count != null && order.product_count > 0 && (
              <InfoRow icon={<Package size={16} />} label="Products">
                {order.product_count} units
                {(() => {
                  const parts: string[] = [];
                  if (order.windows) parts.push(`${order.windows}W`);
                  if (order.patio_doors) parts.push(`${order.patio_doors}PD`);
                  if (order.doors) parts.push(`${order.doors}D`);
                  return parts.length > 0 ? ` (${parts.join("/")})` : "";
                })()}
              </InfoRow>
            )}

            {order.phones && order.phones.length > 0 && (
              <InfoRow icon={<Phone size={16} />} label="Phone">
                {order.phones.map((p) => `${p.label}: ${p.number}`).join(", ")}
              </InfoRow>
            )}

            {order.description && (
              <InfoRow icon={<Hash size={16} />} label="Description">
                {order.description}
              </InfoRow>
            )}

            <div className="flex gap-2 pt-4 border-t border-border">
              <button
                onClick={() => setScheduling(true)}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90 flex items-center justify-center gap-2"
              >
                <Link2 size={16} />
                Schedule / Link
              </button>
              <button
                onClick={() =>
                  openSalesforce(order.work_order_number, order.order_number)
                }
                className="px-4 py-2.5 border border-border rounded-lg font-medium hover:bg-surface flex items-center gap-2 text-sm"
              >
                <ExternalLink size={16} />
                Open in rForce
              </button>
            </div>
          </div>
        </div>
      </div>

      {scheduling && (
        <ScheduleModal
          date={
            order.scheduled_start
              ? new Date(order.scheduled_start.slice(0, 10))
              : new Date()
          }
          prefill={order}
          onClose={() => {
            setScheduling(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-muted mt-0.5">{icon}</div>
      <div>
        <div className="text-xs text-muted">{label}</div>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}
