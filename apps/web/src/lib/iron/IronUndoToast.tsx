/**
 * Wave 7 Iron Companion — undo toast.
 *
 * Shown for 60 seconds after a successful flow execution. Click "Undo"
 * to call iron-undo-flow-run. The countdown is wall-clock based on the
 * server-issued `undo_deadline`, so refreshing the page mid-window keeps
 * the same expiration.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, X, Loader2 } from "lucide-react";
import { ironUndoFlowRun } from "./api";
import { useIronStore } from "./store";

export function IronUndoToast() {
  const store = useIronStore();
  const toast = store.state.undoToast;
  const [remaining, setRemaining] = useState(0);
  const [undoing, setUndoing] = useState(false);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const tick = () => {
      const ms = Math.max(0, toast.expires_at - Date.now());
      setRemaining(ms);
      if (ms === 0) {
        // Auto-dismiss after the window closes (give 5 seconds visual settle)
        setTimeout(() => store.dismissUndoToast(), 5000);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [toast, store]);

  if (!toast) return null;

  const seconds = Math.ceil(remaining / 1000);
  const expired = remaining === 0;

  async function doUndo() {
    if (undoing || expired || !toast) return;
    setUndoing(true);
    setUndoMessage(null);
    try {
      const res = await ironUndoFlowRun({ run_id: toast.run_id });
      if (res.ok) {
        setUndoMessage("Reversed.");
        setTimeout(() => store.dismissUndoToast(), 1500);
      } else {
        setUndoMessage(res.error ?? "Undo failed");
      }
    } catch (err) {
      setUndoMessage(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div
      className="fixed bottom-24 right-6 z-[9997] flex items-center gap-3 rounded-md border border-emerald-500/30 bg-background px-3 py-2 shadow-lg"
      style={{ minWidth: 280 }}
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-foreground">{toast.flow_label}</p>
        {undoMessage ? (
          <p className="text-[10px] text-muted-foreground">{undoMessage}</p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            {expired
              ? "Undo window expired"
              : `Undo available — ${seconds}s remaining`}
          </p>
        )}
      </div>
      {!expired && !undoMessage && (
        <button
          type="button"
          onClick={doUndo}
          disabled={undoing}
          className="rounded border border-border/60 px-2 py-1 text-[10px] text-foreground hover:bg-muted/30 disabled:opacity-30"
        >
          {undoing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Undo"}
        </button>
      )}
      <button
        type="button"
        onClick={() => store.dismissUndoToast()}
        className="rounded p-1 text-muted-foreground hover:bg-muted/30"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
