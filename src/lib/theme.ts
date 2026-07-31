export type Theme = "light" | "dark" | "system";

const THEME_KEY = "rbanwo-sched-theme";

export function getSavedTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(THEME_KEY) as Theme) || "system";
}

export function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  localStorage.setItem(THEME_KEY, theme);
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  } else if (theme === "light") {
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  } else {
    root.classList.remove("dark");
    root.style.colorScheme = "";
  }
}
