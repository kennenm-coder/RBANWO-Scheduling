"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import { upsertCrew, deactivateCrew } from "@/lib/store";
import { crewTypeLabel } from "@/lib/calendar-utils";
import { Crew, CrewType } from "@/lib/types";
import { Plus, Pencil, Trash2, X, Save } from "lucide-react";

export default function CrewManager() {
  const { crews, refreshData } = useData();
  const [editing, setEditing] = useState<Partial<Crew> | null>(null);

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
    await refreshData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this crew member?")) return;
    await deactivateCrew(id);
    await refreshData();
  };

  const typeOrder: CrewType[] = [
    "measure_tech",
    "install_in_house",
    "install_sub",
    "jip",
    "svc",
  ];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Crew Members</h3>
        <button
          onClick={() =>
            setEditing({
              name: "",
              crew_type: "install_in_house",
              color: "#2563eb",
              notes: "",
              sort_order: 99,
            })
          }
          className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs rounded-lg hover:opacity-90"
        >
          <Plus size={14} />
          Add Crew
        </button>
      </div>

      {typeOrder.map((type) => {
        const members = grouped[type];
        if (!members?.length) return null;
        return (
          <div key={type} className="mb-6">
            <h4 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
              {crewTypeLabel(type)}
            </h4>
            <div className="space-y-1">
              {members.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface"
                >
                  <div
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="text-sm flex-1">{c.name}</span>
                  {c.notes && (
                    <span className="text-xs text-muted">{c.notes}</span>
                  )}
                  <button
                    onClick={() => setEditing(c)}
                    className="p-1 rounded hover:bg-border text-muted"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-1 rounded hover:bg-border text-muted"
                  >
                    <Trash2 size={12} />
                  </button>
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
            onClick={() => setEditing(null)}
          />
          <div className="relative bg-background rounded-2xl w-full max-w-sm p-4 space-y-3 animate-slide-up">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {editing.id ? "Edit Crew" : "Add Crew"}
              </h3>
              <button onClick={() => setEditing(null)}>
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
                  {typeOrder.map((t) => (
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
