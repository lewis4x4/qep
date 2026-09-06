import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { getLegacyOfflinePendingCount } from "../lib/offline-store";
import { cn } from "@/lib/utils";

export function SalesOfflineBanner() {
  const [legacyPending, setLegacyPending] = useState(0);
  useEffect(() => { void getLegacyOfflinePendingCount().then(setLegacyPending).catch(() => undefined); }, []);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function handleOffline() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setIsOffline(true);
      setShowReconnected(false);
    }
    function handleOnline() {
      setIsOffline(false);
      setShowReconnected(true);
      reconnectTimer = setTimeout(() => setShowReconnected(false), 3000);
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  if (!isOffline && !showReconnected && !legacyPending) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed top-14 left-0 right-0 z-50 flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium transition-colors duration-300",
        isOffline
          ? "bg-amber-500 text-white"
          : "bg-emerald-500 text-white",
      )}
    >
      {legacyPending > 0 ? (
        <>Previous unassigned offline work is retained on this device. Contact an administrator for recovery.</>
      ) : isOffline ? (
        <>
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          Offline — your changes will sync when connected
        </>
      ) : (
        <>
          <Wifi className="w-3.5 h-3.5 shrink-0" />
          Back online — syncing changes
        </>
      )}
    </div>
  );
}
