"use client";

import { useState } from "react";
import { FileText, Link2, Wrench } from "lucide-react";
import type { Appointment } from "@/lib/types";
import { INSTALL_LINK_TYPES, WRITEUP_TYPES, isValidHttpUrl } from "@/lib/job-links";
import { useJobLinkActions, useJobLinks } from "./JobLinksProvider";
import { useAuth } from "./AuthProvider";

const LEGACY_EDIT_ROLES = ["admin", "scheduling", "scheduling_manager"];

/**
 * Install paperwork for the appointment sheet — parity with the Duck Force
 * calendar's job card: open the material list, open / set / clear a legacy
 * link, or jump to active write-ups on a service job.
 *
 * Material list and write-ups open in Duck Force (that's where they live).
 * Legacy links are edited in the same table Duck Force reads, so a change
 * made here shows there straight away. Renders nothing for other types.
 */
export default function InstallPaperwork({ appointment }: { appointment: Appointment }) {
  const links = useJobLinks(appointment);
  const { setLegacyLink, clearLegacyLink } = useJobLinkActions();
  const { roles, user } = useAuth();
  const canEdit = roles.some((r) => LEGACY_EDIT_ROLES.includes(r));

  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const order = (appointment.order_number || "").trim();
  const isInstall = INSTALL_LINK_TYPES.includes(appointment.appointment_type);
  const isService = WRITEUP_TYPES.includes(appointment.appointment_type);

  if (isService) {
    if (!links.writeUpUrl) return null;
    return (
      <a
        href={links.writeUpUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium"
      >
        <Wrench size={16} />
        Active Write-Ups
        {links.writeUpOrders > 1 && (
          <span className="text-xs font-normal opacity-90">· {links.writeUpOrders} orders</span>
        )}
      </a>
    );
  }

  if (!isInstall || !order) return null;

  if (links.installDocUrl) {
    return (
      <a
        href={links.installDocUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-primary text-white text-sm font-medium"
      >
        <FileText size={16} />
        Open Install Instructions
      </a>
    );
  }

  async function save() {
    const url = input.trim();
    if (!isValidHttpUrl(url)) {
      alert("Enter a valid URL starting with http:// or https://");
      return;
    }
    setSaving(true);
    const ok = await setLegacyLink(order, url, user?.email || undefined);
    setSaving(false);
    if (!ok) {
      alert("Couldn't save the link — try again.");
      return;
    }
    setEditing(false);
  }

  async function clear() {
    if (!confirm("Remove the legacy install link for this job?")) return;
    setSaving(true);
    const ok = await clearLegacyLink(order);
    setSaving(false);
    if (!ok) alert("Couldn't remove the link — try again.");
    else setEditing(false);
  }

  if (links.legacyUrl && !editing) {
    return (
      <div>
        <a
          href={links.legacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-sm font-medium"
        >
          <FileText size={16} />
          Legacy Install Instructions
        </a>
        {canEdit && (
          <div className="flex gap-3 mt-1.5 justify-center">
            <button
              onClick={() => {
                setInput(links.legacyUrl || "");
                setEditing(true);
              }}
              className="text-xs text-muted underline"
            >
              Edit link
            </button>
            <button onClick={clear} disabled={saving} className="text-xs text-red-600 underline disabled:opacity-50">
              Clear
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!canEdit) return null;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 mb-1.5 text-muted">
        <Link2 size={14} />
        <span className="text-xs font-semibold uppercase tracking-wide">Legacy install link</span>
      </div>
      <input
        type="url"
        inputMode="url"
        placeholder="https://drive.google.com/..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="w-full px-2.5 py-2 rounded-lg border border-border bg-background text-sm"
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save link"}
        </button>
        {editing && (
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="px-3 py-2 rounded-lg border border-border text-sm"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
