"use client";

import { useState } from "react";
import { useData } from "./DataProvider";
import { X, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface Props {
  onClose: () => void;
}

export default function TimeOffEditor({ onClose }: Props) {
  const { crews, timeOffRequests, addTimeOff, removeTimeOff } = useData();
  const [employeeName, setEmployeeName] = useState("");
  const [department, setDepartment] = useState("");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sortedRequests = [...timeOffRequests].sort((a, b) =>
    a.start_date.localeCompare(b.start_date)
  );

  const handleAdd = async () => {
    if (!employeeName.trim() || !startDate) return;
    setSaving(true);
    try {
      await addTimeOff({
        employee_name: employeeName.trim(),
        department: department || "Unknown",
        start_date: startDate,
        end_date: endDate || null,
      });
      setEmployeeName("");
      setDepartment("");
      setStartDate(format(new Date(), "yyyy-MM-dd"));
      setEndDate("");
    } catch {
      alert("Failed to save time off request.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await removeTimeOff(id);
    } catch {
      alert("Failed to remove time off request.");
    } finally {
      setDeletingId(null);
    }
  };

  const crewNames = crews
    .filter((c) => c.is_active)
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col animate-slide-up">
        <div className="p-4 flex items-center justify-between border-b border-border">
          <h2 className="text-lg font-semibold">Time Off Manager</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-surface"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Employee
              </label>
              <input
                list="crew-names"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="Name"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
              />
              <datalist id="crew-names">
                {crewNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Department
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
              >
                <option value="">Select...</option>
                <option value="Measure">Measure</option>
                <option value="Install">Install</option>
                <option value="Service">Service</option>
                <option value="JIP">JIP</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                End Date (optional)
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
              />
            </div>
          </div>
          <button
            onClick={handleAdd}
            disabled={saving || !employeeName.trim() || !startDate}
            className="w-full py-2 bg-primary text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {saving ? "Saving..." : "Add Time Off"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {sortedRequests.length === 0 ? (
            <div className="text-center text-muted py-8 text-sm">
              No time off requests recorded.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {req.employee_name}
                    </div>
                    <div className="text-xs text-muted">
                      {req.department} &middot;{" "}
                      {req.start_date}
                      {req.end_date && req.end_date !== req.start_date
                        ? ` – ${req.end_date}`
                        : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(req.id)}
                    disabled={deletingId === req.id}
                    className="p-1.5 rounded-full hover:bg-danger/10 text-danger disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
