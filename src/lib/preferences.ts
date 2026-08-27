import { getSupabase } from "./supabase";
import { applyTheme, Theme } from "./theme";

export interface UserPreferences {
  theme: Theme;
  default_view: "day" | "week";
  density: "compact" | "comfortable";
  department_filters: string[];
  color_overrides: Record<string, string>;
  time_off_color: string;
}

const DEFAULTS: UserPreferences = {
  theme: "system",
  default_view: "week",
  density: "comfortable",
  department_filters: [],
  color_overrides: {},
  time_off_color: "",
};

const LOCAL_KEY = "rbanwo-user-prefs";

function loadLocal(): UserPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function saveLocal(prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(prefs));
}

// ─── Active user + cloud sync ───────────────────────────────────────────────
// The scheduling app stores prefs in localStorage for instant reads and mirrors
// them to sched_user_preferences per signed-in user. AuthProvider registers the
// active user id; setPreferences then debounces a push to Supabase.
let _activeUserId: string | null = null;
let _pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Register (or clear) the signed-in user whose prefs sync to the cloud. */
export function setPreferencesUser(userId: string | null) {
  _activeUserId = userId;
}

function schedulePush() {
  if (!_activeUserId) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  const uid = _activeUserId;
  _pushTimer = setTimeout(() => {
    void syncPreferencesToSupabase(uid, loadLocal());
  }, 800);
}

export function getPreferences(): UserPreferences {
  return loadLocal();
}

export function setPreferences(prefs: Partial<UserPreferences>): UserPreferences {
  const current = loadLocal();
  const merged = { ...current, ...prefs };
  saveLocal(merged);
  if (prefs.theme !== undefined) applyTheme(merged.theme);
  schedulePush();
  return merged;
}

/** Stable per-user color for presence avatars/cursors (deterministic hash). */
const PRESENCE_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c",
  "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#0d9488",
];
export function presenceColorForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

export async function syncPreferencesToSupabase(userId: string, prefs: UserPreferences): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from("sched_user_preferences")
    .upsert({
      user_id: userId,
      ...prefs,
      updated_at: new Date().toISOString(),
    });
}

export async function loadPreferencesFromSupabase(userId: string): Promise<UserPreferences | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("sched_user_preferences")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (!data) return null;
  const prefs: UserPreferences = {
    theme: data.theme || DEFAULTS.theme,
    default_view: data.default_view || DEFAULTS.default_view,
    density: data.density || DEFAULTS.density,
    department_filters: data.department_filters || DEFAULTS.department_filters,
    color_overrides: data.color_overrides || DEFAULTS.color_overrides,
    time_off_color: data.time_off_color || DEFAULTS.time_off_color,
  };
  saveLocal(prefs);
  // Cloud prefs are authoritative once loaded — apply the synced theme (the
  // pre-paint boot script only had this device's cached value).
  applyTheme(prefs.theme);
  return prefs;
}
