/**
 * Post–PR 21 orchestrator slimming: global save keyboard shortcut.
 * Mechanical move from `QuoteBuilderV2Page.tsx`.
 */

import { useEffect } from "react";

export interface UseQuoteBuilderKeyboardShortcutsInput {
  draftReady: boolean;
  savePending: boolean;
  onSave: () => void | Promise<void>;
}

export function useQuoteBuilderKeyboardShortcuts({
  draftReady,
  savePending,
  onSave,
}: UseQuoteBuilderKeyboardShortcutsInput): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!draftReady || savePending) return;
      void onSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draftReady, onSave, savePending]);
}
