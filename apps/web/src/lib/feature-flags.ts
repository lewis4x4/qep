/**
 * Feature flag utility for QEP OS.
 *
 * Flags resolve in this priority order:
 *   1. `localStorage.qep_flag_<flag>` — per-session override for testing (values: "1"/"0")
 *   2. `import.meta.env.VITE_FLAG_<FLAG>` — build-time env var (values: "1"/"0")
 *   3. default (second arg to `isFeatureEnabled`, or false)
 *
 * Flag names are lowercase_snake_case in code. Env vars are UPPER_SNAKE_CASE.
 *
 * Usage:
 *   if (isFeatureEnabled("shell_v2")) { ... }
 *
 * To flip a flag for one tab only (dev/QA):
 *   localStorage.setItem("qep_flag_shell_v2", "1")
 *
 * To flip at build time:
 *   VITE_FLAG_SHELL_V2=1 bun run build
 */

const LOCAL_STORAGE_PREFIX = "qep_flag_";
const ENV_PREFIX = "VITE_FLAG_";

function readLocalStorage(flag: string): "1" | "0" | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const value = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${flag}`);
    if (value === "1" || value === "0") return value;
    return null;
  } catch {
    return null;
  }
}

function readEnv(flag: string): "1" | "0" | null {
  const envKey = `${ENV_PREFIX}${flag.toUpperCase()}`;
  const raw = (import.meta.env as Record<string, string | undefined>)[envKey];
  if (raw === "1" || raw === "0") return raw;
  return null;
}

export function isFeatureEnabled(flag: string, defaultValue = false): boolean {
  const fromStorage = readLocalStorage(flag);
  if (fromStorage !== null) return fromStorage === "1";

  const fromEnv = readEnv(flag);
  if (fromEnv !== null) return fromEnv === "1";

  return defaultValue;
}

/**
 * Set a flag at runtime (survives reload in the same browser tab/profile).
 * Returns true if the flag was set, false if localStorage is unavailable.
 */
export function setFeatureFlag(flag: string, enabled: boolean): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    window.localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${flag}`, enabled ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear a runtime override so the flag falls back to env/default.
 */
export function clearFeatureFlag(flag: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${flag}`);
  } catch {
    // no-op
  }
}

/**
 * Known flag constants. Adding a flag here is optional but recommended
 * so grep-ability stays high and we don't string-match on typos.
 */
export const FLAGS = {
  SHELL_V2: "shell_v2",
} as const;
