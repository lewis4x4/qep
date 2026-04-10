import { Route } from "react-router-dom";
import { lazy } from "react";
import type { ReactElement } from "react";
import { PortalAuthGate } from "./components/PortalAuthGate";

const PortalFleetPage = lazy(() =>
  import("./pages/PortalFleetPage").then((m) => ({ default: m.PortalFleetPage })),
);
const PortalServicePage = lazy(() =>
  import("./pages/PortalServicePage").then((m) => ({ default: m.PortalServicePage })),
);
const PortalDealsPage = lazy(() =>
  import("./pages/PortalDealsPage").then((m) => ({ default: m.PortalDealsPage })),
);
const PortalInvoicesPage = lazy(() =>
  import("./pages/PortalInvoicesPage").then((m) => ({ default: m.PortalInvoicesPage })),
);
const PortalQuotesPage = lazy(() =>
  import("./pages/PortalQuotesPage").then((m) => ({ default: m.PortalQuotesPage })),
);
const PortalPartsPage = lazy(() =>
  import("./pages/PortalPartsPage").then((m) => ({ default: m.PortalPartsPage })),
);
const PortalSettingsPage = lazy(() =>
  import("./pages/PortalSettingsPage").then((m) => ({ default: m.PortalSettingsPage })),
);
const PortalDocumentsPage = lazy(() =>
  import("./pages/PortalDocumentsPage").then((m) => ({ default: m.PortalDocumentsPage })),
);
const PortalFleetMapPage = lazy(() =>
  import("./pages/PortalFleetMapPage").then((m) => ({ default: m.PortalFleetMapPage })),
);

/**
 * Portal route elements — returned as an array so they can be spread
 * directly into a `<Routes>` block.  react-router v6 rejects non-Route
 * component wrappers as children of Routes (the invariant fires on
 * any element whose type !== Route).
 */
export function portalRouteElements(): ReactElement[] {
  const wrap = (element: ReactElement) => <PortalAuthGate>{element}</PortalAuthGate>;
  return [
    <Route key="portal" path="/portal" element={wrap(<PortalFleetPage />)} />,
    <Route key="portal-deals" path="/portal/deals" element={wrap(<PortalDealsPage />)} />,
    <Route key="portal-service" path="/portal/service" element={wrap(<PortalServicePage />)} />,
    <Route key="portal-parts" path="/portal/parts" element={wrap(<PortalPartsPage />)} />,
    <Route key="portal-invoices" path="/portal/invoices" element={wrap(<PortalInvoicesPage />)} />,
    <Route key="portal-quotes" path="/portal/quotes" element={wrap(<PortalQuotesPage />)} />,
    <Route key="portal-settings" path="/portal/settings" element={wrap(<PortalSettingsPage />)} />,
    <Route key="portal-documents" path="/portal/documents" element={wrap(<PortalDocumentsPage />)} />,
    <Route key="portal-fleet-map" path="/portal/fleet" element={wrap(<PortalFleetMapPage />)} />,
  ];
}
