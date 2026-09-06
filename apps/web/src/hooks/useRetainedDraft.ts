import { useEffect, useRef, useState } from "react";

type DraftState<T> = { key: string; value: T; baseline: T; version: string | null };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A local draft belongs to one actor/workspace/record, and never replaces a newer server version silently. */
export function useRetainedDraft<T>(key: string | null, serverValue: T, serverVersion: string | null) {
  const [state, setState] = useState<DraftState<T> | null>(null);
  const [storageError, setStorageError] = useState(false);
  const latest = useRef({ serverValue, serverVersion });
  latest.current = { serverValue, serverVersion };
  const encoded = JSON.stringify(serverValue);

  useEffect(() => {
    if (!key) { setState(null); return; }
    setState((current) => {
      if (current?.key === key) {
        if (!same(current.value, current.baseline)) return current;
        if (same(current.baseline, serverValue) && current.version === serverVersion) return current;
      } else {
        try {
          const saved = localStorage.getItem(key);
          if (saved) {
            const parsed = JSON.parse(saved) as DraftState<T>;
            if (parsed.key === key && parsed.value && parsed.baseline) return parsed;
          }
        } catch { setStorageError(true); }
      }
      return { key, value: serverValue, baseline: serverValue, version: serverVersion };
    });
  }, [key, encoded, serverVersion]);

  const active = state?.key === key ? state : null;
  const dirty = Boolean(active && !same(active.value, active.baseline));
  const conflict = Boolean(dirty && active && (active.version !== serverVersion || !same(active.baseline, serverValue)));
  useEffect(() => {
    if (!active || !key) return;
    try {
      if (dirty) localStorage.setItem(key, JSON.stringify(active));
      else localStorage.removeItem(key);
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [active, dirty, key]);

  function setValue(update: T | ((current: T) => T)) {
    if (!key) return;
    setState((current) => {
      const base = current?.key === key ? current : { key, value: latest.current.serverValue, baseline: latest.current.serverValue, version: latest.current.serverVersion };
      return { ...base, value: typeof update === "function" ? (update as (current: T) => T)(base.value) : update };
    });
  }
  function acceptServer() {
    if (!key) return;
    setState({ key, value: latest.current.serverValue, baseline: latest.current.serverValue, version: latest.current.serverVersion });
  }
  function retainAgainstLatest() {
    setState((current) => current?.key === key ? { ...current, baseline: latest.current.serverValue, version: latest.current.serverVersion } : current);
  }
  function markSaved(value: T, version: string | null) {
    if (!key) return;
    setState((current) => {
      if (current?.key !== key) {
        try { localStorage.removeItem(key); } catch { /* Current editor remains untouched. */ }
        return current;
      }
      return { ...current, baseline: value, version };
    });
  }
  return { value: active?.value ?? serverValue, setValue, dirty, conflict, storageError, version: active?.version ?? serverVersion, acceptServer, retainAgainstLatest, markSaved };
}
