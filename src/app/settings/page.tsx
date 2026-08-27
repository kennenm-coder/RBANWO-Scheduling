"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Coffee, Check, Palmtree } from "lucide-react";
import { Theme, THEME_OPTIONS, applyTheme } from "@/lib/theme";
import { getPreferences, setPreferences, UserPreferences } from "@/lib/preferences";

const THEME_ICON: Record<Theme, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
  cream: Coffee,
};

const TIME_OFF_SWATCHES = ["#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#f97316"];

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);

  useEffect(() => {
    setPrefs(getPreferences());
  }, []);

  function update(patch: Partial<UserPreferences>) {
    const next = setPreferences(patch);
    setPrefs(next);
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
      </div>
    </div>
  );
}
