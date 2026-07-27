"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import { upsertCrew, deactivateCrew } from "@/lib/store";
import { crewTypeLabel } from "@/lib/calendar-utils";
import { Crew, CrewType } from "@/lib/types";
import { Plus, Pencil, Trash2, X, Save, GripVertical } from "lucide-react";

const TYPE_ORDER: CrewType[] = [
  "measure_tech",
  "install_in_house",
  "install_sub",
  "jip",
  "svc",
];

export default function ResourceManager() {
  const { crews, refreshData } = useData();
  const [editing, setEditing] = useState<Partial<Crew> | null>(null);
  const [aliasInput, setAliasInput] = useState("");

  const grouped = crews.reduce(
    (acc, c) => {
      (acc[c.crew_type] = acc[c.crew_type] || []).push(c);
      return acc;
    },
    {} as Record<string, Crew[]>
  );

  const handleSave = async () => {
    if (!editing?.name || !editing?.crew_type) return;
    await upsertCrew(editing as Crew & { name: string; crew_type: string });
    setEditing(null);
    setAliasInput("");
    await refreshData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this resource?")) return;
    await deactivateCrew(id);
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

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">All Resources</h3>
          <p className="text-xs text-muted mt-0.5">{crews.length} active resources</p>
        </div>
        <button
          onClick={() =>
            setEditing({
              name: "",
              crew_type: "install_in_house",
              color: "#2563eb",
              notes: "",
              aliases: [],
              sort_order: 99,
            })
          }
          className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:opacity-90"
        >
          <Plus size={14} />
          Add Resource
        </button>
      </div>

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
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface group"
                >
                  <GripVertical size={12} className="text-muted/30 shrink-0" />
                  <div
                    className="w-4 h-4 rounded-full shrink-0 border border-white shadow-sm"
                    style={{ backgroundColor: c.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.aliases && c.aliases.length > 0 && (
                      <span className="text-[10px] text-muted ml-2">
                        aka {c.aliases.join(", ")}
                      </span>
                    )}
                    {c.notes && (
                      <div className="text-[11px] text-muted mt-0.5">{c.notes}</div>
                    )}
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
          <div className="relative bg-background rounded-2xl w-full max-w-sm p-4 space-y-3 animate-slide-up">
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
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">Type</label>
                <select
                  value={editing.crew_type || "install_in_house"}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      crew_type: e.target.value as CrewType,
                    })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                >
                  {TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {crewTypeLabel(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Color</label>
                <input
                  type="color"
                  value={editing.color || "#2563eb"}
                  onChange={(e) =>
                    setEditing({ ...editing, color: e.target.value })
                  }
                  className="w-full h-9 border border-border rounded-lg cursor-pointer"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Notes</label>
              <input
                type="text"
                value={editing.notes || ""}
                onChange={(e) =>
                  setEditing({ ...editing, notes: e.target.value })
                }
                placeholder="e.g. Office Wed, Late Day Thu"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
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
