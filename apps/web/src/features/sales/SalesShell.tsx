import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { BottomTabBar } from "./components/BottomTabBar";
import { SalesTopHeader } from "./components/SalesTopHeader";
import { SalesOfflineBanner } from "./components/SalesOfflineBanner";
import { registerSyncOnReconnect } from "./lib/sync-engine";
import { useIsHandheldViewport } from "./hooks/useIsHandheldViewport";

const FOCUSED_TASK_ROUTES = [/^\/sales\/quotes\/(new|[^/]+)$/];

export function SalesShell() {
  // Wire up offline sync: syncs pending queue on reconnect + initial load
  useEffect(() => {
    const cleanup = registerSyncOnReconnect();
    return cleanup;
  }, []);

  const location = useLocation();
  const isHandheld = useIsHandheldViewport();
  const inFocusedTask = FOCUSED_TASK_ROUTES.some((pattern) =>
    pattern.test(location.pathname),
  );
  const hideShellChrome = inFocusedTask && isHandheld;

  return (
    <div className="flex flex-col min-h-screen bg-[hsl(var(--qep-bg))]">
      <SalesOfflineBanner />
      {!hideShellChrome && <SalesTopHeader />}

      <main
        className={
          hideShellChrome
            ? "flex-1 overflow-y-auto"
            : "flex-1 pt-14 pb-20 overflow-y-auto"
        }
      >
        <Outlet />
      </main>

      {!hideShellChrome && <BottomTabBar />}
    </div>
  );
}
