export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "qep-theme-preference";

const listeners = new Set<() => void>();

let preference: ThemePreference = "system";

function readStored(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function resolveDark(pref: ThemePreference): boolean {
  if (typeof window === "undefined") return false;
  if (pref === "dark") return true;
  if (pref === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyDarkClass(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveDark(pref));
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  applyDarkClass(next);
  listeners.forEach((l) => l());
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Snapshot for useSyncExternalStore — changes when preference or OS theme matters. */
export function getThemeSnapshot(): string {
  const p = preference;
  if (p === "light") return "light";
  if (p === "dark") return "dark";
  if (typeof window === "undefined") return "system:light";
  const sys = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  return `system:${sys}`;
}

export function subscribeThemeAndSystem(onStore: () => void): () => void {
  const unsub = subscribeTheme(onStore);
  if (typeof window === "undefined") return unsub;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onStore);
  return () => {
    unsub();
    mq.removeEventListener("change", onStore);
  };
}

if (typeof window !== "undefined") {
  preference = readStored();
  applyDarkClass(preference);
}
