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

// WAVE phase 1: Quote Builder + Quote List now host inside SalesShell.
const QuoteListPage = lazy(() =>
  import("../quote-builder/pages/QuoteListPage").then((m) => ({ default: m.QuoteListPage })),
);
const QuoteBuilderV2Page = lazy(() =>
  import("../quote-builder/pages/QuoteBuilderV2Page").then((m) => ({ default: m.QuoteBuilderV2Page })),
);

// WAVE phase 2: Field Note + history host inside SalesShell.
const FieldNotePage = lazy(() =>
  import("./pages/FieldNotePage").then((m) => ({ default: m.FieldNotePage })),
);
const FieldNoteHistoryPage = lazy(() =>
  import("./pages/FieldNoteHistoryPage").then((m) => ({ default: m.FieldNoteHistoryPage })),
);

// WAVE phase 3: Voice Quote hosts inside SalesShell.
const VoiceQuotePage = lazy(() =>
  import("../voice-quote/pages/VoiceQuotePage").then((m) => ({ default: m.VoiceQuotePage })),
);

// WAVE phase 4: Rep My Mirror reflection page (mobile-first).
const MyMirrorPage = lazy(() =>
  import("./pages/MyMirrorPage").then((m) => ({ default: m.MyMirrorPage })),
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
        {/* WAVE phase 1: Quote routes */}
        <Route
          path="quotes"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <QuoteListPage />
            </Suspense>
          }
        />
        <Route
          path="quotes/new"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <QuoteBuilderV2Page />
            </Suspense>
          }
        />
        <Route
          path="quotes/:quoteId"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <QuoteBuilderV2Page />
            </Suspense>
          }
        />
        {/* WAVE phase 2: Field Note routes */}
        <Route
          path="field-note"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <FieldNotePage />
            </Suspense>
          }
        />
        <Route
          path="field-note/history"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <FieldNoteHistoryPage />
            </Suspense>
          }
        />
        {/* WAVE phase 3: Voice Quote route */}
        <Route
          path="voice-quote"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <VoiceQuotePage />
            </Suspense>
          }
        />
        {/* WAVE phase 4: Rep My Mirror */}
        <Route
          path="my-mirror"
          element={
            <Suspense fallback={<SalesRouteFallback />}>
              <MyMirrorPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
