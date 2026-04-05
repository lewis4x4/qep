import { Route } from "react-router-dom";
import { lazy } from "react";

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

/** Customer portal routes (also mounted from `NoProfileShell` for portal-only accounts). */
export function PortalRoutes() {
  return (
    <>
      <Route path="/portal" element={<PortalFleetPage />} />
      <Route path="/portal/service" element={<PortalServicePage />} />
      <Route path="/portal/parts" element={<PortalPartsPage />} />
      <Route path="/portal/invoices" element={<PortalInvoicesPage />} />
      <Route path="/portal/quotes" element={<PortalQuotesPage />} />
      <Route path="/portal/settings" element={<PortalSettingsPage />} />
    </>
  );
}
