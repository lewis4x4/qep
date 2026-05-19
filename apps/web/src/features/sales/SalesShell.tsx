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
    <div
      className="flex h-[100dvh] flex-col overflow-hidden bg-[hsl(var(--qep-bg))]"
      data-testid="sales-shell"
    >
      <SalesOfflineBanner />
      <SalesTopHeader />

      <main
        className="min-h-0 flex-1 overflow-y-auto pt-14 pb-[calc(var(--sales-shell-bottom-offset)+0.75rem)]"
        data-testid="sales-shell-scroll-root"
      >
        <Outlet />
      </main>

      <BottomTabBar />
    </div>
  );
}
