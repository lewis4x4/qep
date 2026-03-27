import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

export function OfflineBanner(): React.ReactElement | null {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    function handleOffline() {
      setIsOffline(true);
      setShowReconnected(false);
    }

    function handleOnline() {
      setIsOffline(false);
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(timer);
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline && !showReconnected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-300",
        isOffline
          ? "bg-[hsl(var(--destructive))] text-white"
          : "bg-[hsl(var(--success))] text-white"
      )}
    >
      {isOffline ? (
        <>
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          You're offline — some features may be unavailable
        </>
      ) : (
        <>
          <Wifi className="w-4 h-4 shrink-0" aria-hidden="true" />
          Back online
        </>
      )}
    </div>
  );
}
