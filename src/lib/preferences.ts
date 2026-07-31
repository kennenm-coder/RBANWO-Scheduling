import { getSupabase } from "./supabase";

export interface UserPreferences {
  theme: "light" | "dark" | "system";
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

export function getPreferences(): UserPreferences {
  return loadLocal();
}

export function setPreferences(prefs: Partial<UserPreferences>): UserPreferences {
  const current = loadLocal();
  const merged = { ...current, ...prefs };
  saveLocal(merged);
  return merged;
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
  return prefs;
}
