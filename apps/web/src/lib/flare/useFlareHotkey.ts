/**
 * Wave 6.11 Flare — global hotkey hook.
 *
 * Ctrl+Shift+B (Cmd+Shift+B on mac) → bug report
 * Ctrl+Shift+I (Cmd+Shift+I on mac) → idea
 *
 * Uses capture phase so the hotkey fires even when focus is inside a
 * contentEditable, Monaco editor, or modal dialog. preventDefault
 * prevents browser devtools shortcuts from swallowing it.
 */
import { useEffect } from "react";

interface Opts {
  onBug: () => void;
  onIdea: () => void;
  enabled?: boolean;
}

export function useFlareHotkey({ onBug, onIdea, enabled = true }: Opts): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        e.stopPropagation();
        onBug();
      } else if (key === "i") {
        e.preventDefault();
        e.stopPropagation();
        onIdea();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onBug, onIdea, enabled]);
}
