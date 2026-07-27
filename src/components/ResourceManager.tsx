"use client";

import { useState, useMemo } from "react";
import { useData } from "./DataProvider";
import { upsertCrew, deactivateCrew, toggleCrewActive } from "@/lib/store";
import { crewTypeLabel } from "@/lib/calendar-utils";
import { Crew, CrewType, ManagesType } from "@/lib/types";
import { findUnmatchedNames } from "@/lib/unmatched-resources";
import {
  Plus, Pencil, Trash2, X, Save, AlertTriangle,
  UserPlus, Link2, ToggleLeft, ToggleRight,
} from "lucide-react";

const TYPE_ORDER: CrewType[] = [
  "measure_tech",
  "install_in_house",
  "install_sub",
  "jip",
  "svc",
  "second",
  "management",
  "misc",
];

const MANAGES_OPTIONS: { value: ManagesType; label: string }[] = [
  { value: "install", label: "Install" },
  { value: "service", label: "Service" },
  { value: "jip", label: "JIP" },
];

export default function ResourceManager() {
  const { crews, rforceOrders, timeOffRequests, refreshData } = useData();
  const [editing, setEditing] = useState<Partial<Crew> | null>(null);
  const [aliasInput, setAliasInput] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [linkingAlias, setLinkingAlias] = useState<string | null>(null);

  const allCrews = crews;
  const displayCrews = showInactive ? allCrews : allCrews.filter((c) => c.is_active);

  const unmatched = useMemo(
    () => findUnmatchedNames(allCrews, rforceOrders, timeOffRequests),
    [allCrews, rforceOrders, timeOffRequests]
  );

  const grouped = displayCrews.reduce(
    (acc, c) => {
      (acc[c.crew_type] = acc[c.crew_type] || []).push(c);
      return acc;
    },
    {} as Record<string, Crew[]>
  );

  const handleQuickAdd = (name: string, type: CrewType) => {
    setEditing({
      name,
      crew_type: type,
      color: type === "misc" ? "#6b7280" : type === "management" ? "#7c3aed" : "#2563eb",
      notes: "",
      aliases: [],
      manages: [],
      primary_crew_id: null,
      sort_order: type === "misc" ? 99 : type === "management" ? 95 : 50,
    });
    setAliasInput("");
    setLinkingAlias(null);
  };

  const handleLinkAlias = async (name: string, crewId: string) => {
    const crew = allCrews.find((c) => c.id === crewId);
    if (!crew) return;
    const aliases = [...(crew.aliases || []), name];
    await upsertCrew({ ...crew, aliases });
    setLinkingAlias(null);
    await refreshData();
  };

  const handleSave = async () => {
    if (!editing?.name || !editing?.crew_type) return;
    const payload: Record<string, unknown> = {
      name: editing.name,
      crew_type: editing.crew_type,
      color: editing.color || "#2563eb",
      notes: editing.notes || "",
      aliases: editing.aliases || [],
      sort_order: editing.sort_order ?? 99,
    };
    if (editing.id) payload.id = editing.id;
    if (editing.is_active !== undefined) payload.is_active = editing.is_active;
    if (editing.manages && editing.manages.length > 0) payload.manages = editing.manages;
    if (editing.primary_crew_id) payload.primary_crew_id = editing.primary_crew_id;
    try {
      await upsertCrew(payload as Crew & { name: string; crew_type: string });
      setEditing(null);
      setAliasInput("");
      await refreshData();
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this resource?")) return;
    await deactivateCrew(id);
    await refreshData();
  };

  const handleToggleActive = async (crew: Crew) => {
    await toggleCrewActive(crew.id, !crew.is_active);
    await refreshData();
  };

  const addAlias = () => {
    const trimmed = aliasInput.trim();
    if (!trimmed) return;
    const current = editing?.aliases || [];
    if (current.some((a) => a.toLowerCase() === trimmed.toLowerCase())) return;
    setEditing({ ...editing, aliases: [...current, trimmed] });
    setAliasInput("");
  };

  const removeAlias = (index: number) => {
    const current = editing?.aliases || [];
    setEditing({ ...editing, aliases: current.filter((_, i) => i !== index) });
  };

  const toggleManages = (val: ManagesType) => {
    const current = editing?.manages || [];
    const next = current.includes(val)
      ? current.filter((m) => m !== val)
      : [...current, val];
    setEditing({ ...editing, manages: next });
  };

  const primaryName = (id: string | null | undefined) => {
    if (!id) return null;
    return allCrews.find((c) => c.id === id)?.name || null;
  };

  const activeCount = allCrews.filter((c) => c.is_active).length;
  const inactiveCount = allCrews.filter((c) => !c.is_active).length;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">All Resources</h3>
          <p className="text-xs text-muted mt-0.5">
            {activeCount} active{inactiveCount > 0 && `, ${inactiveCount} inactive`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inactiveCount > 0 && (
            <button
              onClick={() => setShowInactive(!showInactive)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                showInactive
                  ? "bg-primary text-white border-primary"
                  : "text-muted border-border hover:bg-surface"
              }`}
            >
              {showInactive ? "Hide" : "Show"} Inactive
            </button>
          )}
          <button
            onClick={() =>
              setEditing({
                name: "",
                crew_type: "install_in_house",
                color: "#2563eb",
                notes: "",
                aliases: [],
                manages: [],
                primary_crew_id: null,
                sort_order: 99,
              })
            }
            className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:opacity-90"
          >
            <Plus size={14} />
            Add Resource
          </button>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div className="mb-6 border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-red-500" />
            <h4 className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">
              {unmatched.length} Unmatched {unmatched.length === 1 ? "Name" : "Names"}
            </h4>
          </div>
          <p className="text-xs text-red-600/70 dark:text-red-400/60 mb-3">
            These names appear in rForce or time-off but don&apos;t match any resource.
          </p>
          <div className="space-y-1.5">
            {unmatched.map((u) => (
              <div key={u.name} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-background rounded-lg">
                <span className="text-sm flex-1">{u.name}</span>
                <span className="text-[10px] text-muted px-1.5 py-0.5 bg-surface rounded">
                  {u.source === "rforce" ? "rForce" : "Time Off"}
                </span>
                {linkingAlias === u.name ? (
                  <div className="flex items-center gap-1">
                    <select
                      className="text-[10px] border border-border rounded px-1.5 py-1 bg-background"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleLinkAlias(u.name, e.target.value);
                      }}
                    >
                      <option value="" disabled>Pick resource...</option>
                      {allCrews
                        .filter((c) => c.is_active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <button
                      onClick={() => setLinkingAlias(null)}
                      className="p-0.5 text-muted hover:text-foreground"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setLinkingAlias(u.name)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors"
                      title="Add as alias to existing resource"
                    >
                      <Link2 size={10} />
                      Alias
                    </button>
                    <button
                      onClick={() => handleQuickAdd(u.name, "misc")}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-colors"
                    >
                      <UserPlus size={10} />
                      Add
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {TYPE_ORDER.map((type) => {
        const members = grouped[type];
        if (!members?.length) return null;
        return (
          <div key={type} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">
                {crewTypeLabel(type)}
              </h4>
              <span className="text-[10px] text-muted bg-surface px-1.5 py-0.5 rounded-full">
                {members.length}
              </span>
            </div>
            <div className="space-y-1">
              {members.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface group ${
                    !c.is_active ? "opacity-40" : ""
                  }`}
                >
                  <button
                    onClick={() => handleToggleActive(c)}
                    className="shrink-0 text-muted hover:text-foreground"
                    title={c.is_active ? "Deactivate" : "Activate"}
                  >
                    {c.is_active ? (
                      <ToggleRight size={18} className="text-green-500" />
                    ) : (
                      <ToggleLeft size={18} className="text-muted" />
                    )}
                  </button>
                  <div
                    className="w-4 h-4 rounded-full shrink-0 border border-white shadow-sm"
                    style={{ backgroundColor: c.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                      {!c.is_active && (
                        <span className="text-[9px] text-muted px-1 py-0.5 border border-border rounded">
                          Inactive
                        </span>
                      )}
                      {c.aliases && c.aliases.length > 0 && (
                        <span className="text-[10px] text-muted">
                          aka {c.aliases.join(", ")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {c.notes && (
                        <span className="text-[11px] text-muted">{c.notes}</span>
                      )}
                      {c.manages && c.manages.length > 0 && (
                        <span className="text-[10px] text-purple-600 dark:text-purple-400">
                          Manages: {c.manages.join(", ")}
                        </span>
                      )}
                      {c.primary_crew_id && (
                        <span className="text-[10px] text-blue-600 dark:text-blue-400">
                          Second to {primaryName(c.primary_crew_id) || "?"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setEditing(c);
                        setAliasInput("");
                      }}
                      className="p-1.5 rounded hover:bg-border text-muted"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="p-1.5 rounded hover:bg-border text-muted"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { setEditing(null); setAliasInput(""); }}
          />
          <div className="relative bg-background rounded-2xl w-full max-w-md p-4 space-y-3 animate-slide-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {editing.id ? "Edit Resource" : "Add Resource"}
              </h3>
              <button onClick={() => { setEditing(null); setAliasInput(""); }}>
                <X size={18} />
              </button>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Name</label>
              <input
                type="text"
                value={editing.name || ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">Type</label>
                <select
                  value={editing.crew_type || "install_in_house"}
                  onChange={(e) =>
                    setEditing({ ...editing, crew_type: e.target.value as CrewType })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                >
                  {TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>{crewTypeLabel(t)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Color</label>
                <input
                  type="color"
                  value={editing.color || "#2563eb"}
                  onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  className="w-full h-9 border border-border rounded-lg cursor-pointer"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Notes</label>
              <input
                type="text"
                value={editing.notes || ""}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder="e.g. Office Wed, Late Day Thu"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>

            {editing.crew_type === "management" && (
              <div>
                <label className="block text-xs text-muted mb-1">Manages</label>
                <div className="flex gap-2">
                  {MANAGES_OPTIONS.map((opt) => {
                    const active = editing.manages?.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => toggleManages(opt.value)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          active
                            ? "bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300"
                            : "border-border text-muted hover:bg-surface"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {editing.crew_type === "second" && (
              <div>
                <label className="block text-xs text-muted mb-1">Primary Resource (Second to)</label>
                <select
                  value={editing.primary_crew_id || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, primary_crew_id: e.target.value || null })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                >
                  <option value="">Select primary resource...</option>
                  {allCrews
                    .filter((c) => c.is_active && c.crew_type !== "misc" && c.crew_type !== "second" && c.crew_type !== "management")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({crewTypeLabel(c.crew_type)})
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs text-muted mb-1">
                Nicknames / Aliases
                <span className="font-normal text-muted/60 ml-1">(for time-off matching)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                  placeholder="e.g. Timothy Fitzpatrick"
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-background"
                />
                <button
                  onClick={addAlias}
                  className="px-3 py-2 bg-surface border border-border rounded-lg text-xs font-medium hover:bg-border"
                >
                  Add
                </button>
              </div>
              {(editing.aliases?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {editing.aliases!.map((alias, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface border border-border rounded-full text-xs"
                    >
                      {alias}
                      <button
                        onClick={() => removeAlias(i)}
                        className="text-muted hover:text-foreground"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleSave}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90"
            >
              <Save size={14} />
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
