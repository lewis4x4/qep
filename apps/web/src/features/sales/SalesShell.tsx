import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { BottomTabBar } from "./components/BottomTabBar";
import { SalesTopHeader } from "./components/SalesTopHeader";
import { SalesOfflineBanner } from "./components/SalesOfflineBanner";
import { registerSyncOnReconnect } from "./lib/sync-engine";

export function SalesShell() {
  useEffect(() => {
    const cleanup = registerSyncOnReconnect();
    return cleanup;
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-[hsl(var(--qep-bg))]">
      <SalesOfflineBanner />
      <SalesTopHeader />

      <main className="flex-1 pt-14 pb-20 overflow-y-auto">
        <Outlet />
      </main>

      <BottomTabBar />
    </div>
  );
}
