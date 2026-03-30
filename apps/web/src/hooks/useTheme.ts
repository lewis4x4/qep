import { useCallback, useSyncExternalStore } from "react";
import {
  getThemePreference,
  getThemeSnapshot,
  setThemePreference,
  subscribeThemeAndSystem,
  type ThemePreference,
} from "@/lib/theme-store";

export function useTheme(): {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  resolvedDark: boolean;
} {
  const snapshot = useSyncExternalStore(
    subscribeThemeAndSystem,
    getThemeSnapshot,
    () => "system:light"
  );

  const preference = getThemePreference();
  const resolvedDark =
    preference === "dark" ||
    (preference === "system" && snapshot === "system:dark");

  const setPreference = useCallback((p: ThemePreference) => {
    setThemePreference(p);
  }, []);

  return { preference, setPreference, resolvedDark };
}
