export type Theme = "light" | "dark" | "cream" | "system";

const THEME_KEY = "rbanwo-sched-theme";

/** User-facing theme options, in display order. */
export const THEME_OPTIONS: { value: Theme; label: string; hint: string }[] = [
  { value: "system", label: "System", hint: "Match your device" },
  { value: "light", label: "Light", hint: "Bright & clean" },
  { value: "dark", label: "Dark", hint: "Low light" },
  { value: "cream", label: "Cream", hint: "Warm paper" },
];

export function getSavedTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(THEME_KEY) as Theme) || "system";
}

export function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  localStorage.setItem(THEME_KEY, theme);
  const root = document.documentElement;
  root.classList.remove("dark", "cream");
  if (theme === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  } else if (theme === "light") {
    root.style.colorScheme = "light";
  } else if (theme === "cream") {
    // Cream is a warm light theme — force light color-scheme so native
    // controls/scrollbars stay light even when the OS is set to dark.
    root.classList.add("cream");
    root.style.colorScheme = "light";
  } else {
    // system — let prefers-color-scheme decide
    root.style.colorScheme = "";
  }
}
