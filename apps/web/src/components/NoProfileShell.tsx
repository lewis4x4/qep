import { Suspense } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { lazy } from "react";
import { OfflineBanner } from "./OfflineBanner";
import { NotFoundPage } from "./NotFoundPage";
import { Toaster } from "@/components/ui/toaster";
import { portalRouteElements } from "@/features/portal/PortalRoutes";
import { supabase } from "@/lib/supabase";

const VendorPricingPortalPage = lazy(() =>
  import("@/features/service/pages/VendorPricingPortalPage").then((m) => ({ default: m.VendorPricingPortalPage })),
);

function RouteFallback() {
  return (
    <div
      className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-6"
      role="status"
      aria-label="Loading page"
    >
      <div
        className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * Signed-in users without a `profiles` row (e.g. portal-only customers) cannot use the main app shell.
 * Allow `/portal/*` so customer workflows still render; everything else shows the same recovery UI as before.
 */
export function NoProfileShell({ authError }: { authError: string | null }) {
  const location = useLocation();
  const isPortal =
    location.pathname === "/portal" || location.pathname.startsWith("/portal/");
  const isVendorPortal = location.pathname.startsWith("/vendor/pricing/");

  if (isPortal || isVendorPortal) {
    return (
      <>
        <OfflineBanner />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {portalRouteElements()}
            <Route path="/vendor/pricing/:accessKey" element={<VendorPricingPortalPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
        <Toaster />
      </>
    );
  }

  const profileLoadFailed = Boolean(authError);

  return (
    <>
      <OfflineBanner />
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center max-w-md" role="status" aria-live="polite">
          {profileLoadFailed ? (
            <>
              <div className="w-8 h-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-3 text-sm font-semibold">
                !
              </div>
              <p className="text-sm font-medium text-foreground">We could not load your workspace access</p>
              <p className="mt-2 text-sm text-muted-foreground">{authError}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Customer? Open <a className="text-primary underline" href="/portal">/portal</a> to use the customer portal.
              </p>
              <button
                type="button"
                onClick={() => {
                  void supabase.auth.signOut();
                }}
                className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Sign in again
              </button>
            </>
          ) : (
            <>
              <div
                className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">Finishing sign-in...</p>
              <p className="mt-2 text-sm text-muted-foreground">
                We're loading your workspace access and route permissions.
              </p>
            </>
          )}
        </div>
      </div>
      <Toaster />
    </>
  );
}
