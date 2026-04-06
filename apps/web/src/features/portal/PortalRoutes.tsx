import { Route } from "react-router-dom";
import { lazy } from "react";
import type { ReactElement } from "react";

const PortalFleetPage = lazy(() =>
  import("./pages/PortalFleetPage").then((m) => ({ default: m.PortalFleetPage })),
);
const PortalServicePage = lazy(() =>
  import("./pages/PortalServicePage").then((m) => ({ default: m.PortalServicePage })),
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

/**
 * Portal route elements — returned as an array so they can be spread
 * directly into a `<Routes>` block.  react-router v6 rejects non-Route
 * component wrappers as children of Routes (the invariant fires on
 * any element whose type !== Route).
 */
export function portalRouteElements(): ReactElement[] {
  return [
    <Route key="portal" path="/portal" element={<PortalFleetPage />} />,
    <Route key="portal-service" path="/portal/service" element={<PortalServicePage />} />,
    <Route key="portal-parts" path="/portal/parts" element={<PortalPartsPage />} />,
    <Route key="portal-invoices" path="/portal/invoices" element={<PortalInvoicesPage />} />,
    <Route key="portal-quotes" path="/portal/quotes" element={<PortalQuotesPage />} />,
    <Route key="portal-settings" path="/portal/settings" element={<PortalSettingsPage />} />,
    <Route key="portal-documents" path="/portal/documents" element={<PortalDocumentsPage />} />,
  ];
}
