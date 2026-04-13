import { lazy, Suspense } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { PartsCompanionShell } from "./PartsCompanionShell";

const QueuePage = lazy(() =>
  import("./pages/QueuePage").then((m) => ({ default: m.QueuePage })),
);
const LookupPage = lazy(() =>
  import("./pages/LookupPage").then((m) => ({ default: m.LookupPage })),
);
const MachinesPage = lazy(() =>
  import("./pages/MachinesPage").then((m) => ({ default: m.MachinesPage })),
);
const MachineProfilePage = lazy(() =>
  import("./pages/MachineProfilePage").then((m) => ({
    default: m.MachineProfilePage,
  })),
);

function CompanionFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function PartsCompanionRoutes() {
  return (
    <Routes>
      <Route element={<PartsCompanionShell />}>
        <Route
          index
          element={<Navigate to="/parts/companion/queue" replace />}
        />
        <Route
          path="queue"
          element={
            <Suspense fallback={<CompanionFallback />}>
              <QueuePage />
            </Suspense>
          }
        />
        <Route
          path="lookup"
          element={
            <Suspense fallback={<CompanionFallback />}>
              <LookupPage />
            </Suspense>
          }
        />
        <Route
          path="machines"
          element={
            <Suspense fallback={<CompanionFallback />}>
              <MachinesPage />
            </Suspense>
          }
        />
        <Route
          path="machines/:machineId"
          element={
            <Suspense fallback={<CompanionFallback />}>
              <MachineProfilePage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
