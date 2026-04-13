import { lazy, Suspense } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { SalesShell } from "./SalesShell";

const TodayFeedPage = lazy(() =>
  import("./pages/TodayFeedPage").then((m) => ({ default: m.TodayFeedPage })),
);
const PipelineBoardPage = lazy(() =>
  import("./pages/PipelineBoardPage").then((m) => ({ default: m.PipelineBoardPage })),
);
const CustomerListPage = lazy(() =>
  import("./pages/CustomerListPage").then((m) => ({ default: m.CustomerListPage })),
);
const CustomerDetailPage = lazy(() =>
  import("./pages/CustomerDetailPage").then((m) => ({ default: m.CustomerDetailPage })),
);

function SalesRouteFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function SalesRoutes() {
  return (
    <Routes>
      <Route element={<SalesShell />}>
        <Route
          index
          element={<Navigate to="/sales/today" replace />}
        />
        <Route
          path="today"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <TodayFeedPage />
            </Suspense>
          }
        />
        <Route
          path="pipeline"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <PipelineBoardPage />
            </Suspense>
          }
        />
        <Route
          path="customers"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <CustomerListPage />
            </Suspense>
          }
        />
        <Route
          path="customers/:companyId"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <CustomerDetailPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
