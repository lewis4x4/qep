/**
 * FloorFooter — 36px footer with sync state + "Office view" escape hatch.
 *
 * Kept deliberately quiet — the Floor is about what's above, not below.
 */
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

export interface FloorFooterProps {
  /** True when the user has admin rights and the /admin dense view is
   *  reachable. Shows the "Office view" link. */
  showOfficeLink: boolean;
  /** When a layout row exists, surface when it was last edited. Null
   *  when no stored layout (empty-state). */
  layoutUpdatedAt: string | null;
}

export function FloorFooter({ showOfficeLink, layoutUpdatedAt }: FloorFooterProps) {
  const onlineStatus = useOnlineStatus();
  const since = layoutUpdatedAt ? formatRelative(layoutUpdatedAt) : null;

  return (
    <footer className="flex h-9 shrink-0 items-center justify-between border-t border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))]/95 px-4 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5" aria-live="polite">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              onlineStatus === "online"
                ? "bg-emerald-400"
                : onlineStatus === "syncing"
                  ? "bg-[hsl(var(--qep-orange))] animate-pulse"
                  : "bg-rose-400"
            }`}
          />
          <span className="uppercase tracking-[0.14em]">{onlineStatus}</span>
        </span>
        {since && <span className="hidden sm:inline">· layout {since}</span>}
      </div>
      {showOfficeLink && (
        <Link
          to="/"
          className="font-kpi text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-[hsl(var(--qep-orange))]"
        >
          Office view →
        </Link>
      )}
    </footer>
  );
}

type OnlineStatus = "online" | "offline" | "syncing";

function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>(
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
  );
  useEffect(() => {
    const up = () => setStatus("online");
    const down = () => setStatus("offline");
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return status;
}

/** Rough relative-time formatter. "moments ago", "14m ago", "2h ago", "3d ago". */
function formatRelative(isoTs: string): string {
  const then = new Date(isoTs).getTime();
  const diffMs = Date.now() - then;
  if (!Number.isFinite(diffMs) || diffMs < 0) return "recently";
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "moments ago";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(isoTs).toLocaleDateString();
}
