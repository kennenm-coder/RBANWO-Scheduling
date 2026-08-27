"use client";

import { useEffect, useMemo, useState } from "react";
import { Sun, Moon, Monitor, Coffee, Check, Palmtree, RotateCcw } from "lucide-react";
import { Theme, THEME_OPTIONS, applyTheme } from "@/lib/theme";
import { getPreferences, setPreferences, UserPreferences } from "@/lib/preferences";
import { useData } from "@/components/DataProvider";
import { crewTypeLabel } from "@/lib/calendar-utils";
import { CrewType } from "@/lib/types";

const THEME_ICON: Record<Theme, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
  cream: Coffee,
};

const TIME_OFF_SWATCHES = ["#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#f97316"];

const RESOURCE_TYPE_ORDER: CrewType[] = [
  "measure_tech", "install_in_house", "install_sub", "jip", "svc", "second", "management", "misc",
];

export default function SettingsPage() {
  const { crews } = useData();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);

  useEffect(() => {
    setPrefs(getPreferences());
  }, []);

  function update(patch: Partial<UserPreferences>) {
    const next = setPreferences(patch);
    setPrefs(next);
  }

  // Active resources grouped by type, in display order.
  const groupedCrews = useMemo(() => {
    const active = crews.filter((c) => c.is_active);
    return RESOURCE_TYPE_ORDER
      .map((type) => ({ type, list: active.filter((c) => c.crew_type === type) }))
      .filter((g) => g.list.length > 0);
  }, [crews]);

  function setCrewColor(crewId: string, color: string) {
    update({ color_overrides: { ...prefs!.color_overrides, [crewId]: color } });
  }
  function resetCrewColor(crewId: string) {
    const next = { ...prefs!.color_overrides };
    delete next[crewId];
    update({ color_overrides: next });
  }

  if (!prefs) return null;

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3 sticky top-0 z-30">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-[11px] text-muted">These preferences are saved to your account.</p>
      </header>

      <div className="flex-1 overflow-auto p-4 max-w-xl w-full mx-auto space-y-8">
        {/* ── Theme ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold mb-1">Theme</h2>
          <p className="text-xs text-muted mb-3">Pick how the app looks. Only you see your choice.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEME_OPTIONS.map(({ value, label, hint }) => {
              const Icon = THEME_ICON[value];
              const active = prefs.theme === value;
              return (
                <button
                  key={value}
                  onClick={() => update({ theme: value })}
                  className={`relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary-light"
                      : "border-border hover:bg-surface"
                  }`}
                >
                  {active && (
                    <Check size={14} className="absolute top-2 right-2 text-primary" />
                  )}
                  <Icon size={18} className={active ? "text-primary" : "text-muted"} />
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-[11px] text-muted">{hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Time off color ────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <Palmtree size={14} className="text-muted" /> Time off color
          </h2>
          <p className="text-xs text-muted mb-3">Tint used for your time-off blocks. Default follows the theme.</p>
          <div className="flex items-center gap-2">
            {TIME_OFF_SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => update({ time_off_color: prefs.time_off_color === c ? "" : c })}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  prefs.time_off_color === c ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            {prefs.time_off_color && (
              <button
                onClick={() => update({ time_off_color: "" })}
                className="text-xs text-muted hover:text-foreground ml-1"
              >
                Reset
              </button>
            )}
          </div>
        </section>

        {/* ── Resource colors ───────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold mb-1">Resource colors</h2>
          <p className="text-xs text-muted mb-3">
            Recolor any resource just for yourself. The default is the shared team color —
            your changes don&apos;t affect anyone else.
          </p>
          <div className="space-y-5">
            {groupedCrews.map(({ type, list }) => (
              <div key={type}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">
                  {crewTypeLabel(type)}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {list.map((crew) => {
                    const override = prefs.color_overrides?.[crew.id];
                    const effective = override || crew.color || "#1a73e8";
                    return (
                      <div key={crew.id} className="flex items-center gap-2">
                        <label
                          className="relative w-5 h-5 rounded-full shrink-0 cursor-pointer border border-border overflow-hidden"
                          style={{ backgroundColor: effective }}
                          title="Change color"
                        >
                          <input
                            type="color"
                            value={effective}
                            onChange={(e) => setCrewColor(crew.id, e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                        </label>
                        <span className="text-sm truncate flex-1">{crew.name}</span>
                        {override && (
                          <button
                            onClick={() => resetCrewColor(crew.id)}
                            className="text-muted hover:text-foreground shrink-0"
                            title="Reset to team default"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {groupedCrews.length === 0 && (
              <p className="text-xs text-muted">No active resources to color yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
