import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { BottomTabBar } from "./components/BottomTabBar";
import { SalesTopHeader } from "./components/SalesTopHeader";
import { SalesOfflineBanner } from "./components/SalesOfflineBanner";
import { registerSyncOnReconnect } from "./lib/sync-engine";

export function SalesShell() {
  // Wire up offline sync: syncs pending queue on reconnect + initial load
  useEffect(() => {
    const cleanup = registerSyncOnReconnect();
    return cleanup;
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-[hsl(var(--qep-bg))]">
      <SalesOfflineBanner />
      <SalesTopHeader />

      {/* Main content — clears header (56px) and tab bar (64px + safe area) */}
      <main className="flex-1 pt-14 pb-20 overflow-y-auto">
        <Outlet />
      </main>

      <BottomTabBar />
    </div>
  );
}
