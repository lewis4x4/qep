import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./components/LoginPage";
import { AppLayout } from "./components/AppLayout";
import { DashboardPage } from "./components/DashboardPage";
import { OfflineBanner } from "./components/OfflineBanner";
import { SessionExpiredModal } from "./components/SessionExpiredModal";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { NotFoundPage } from "./components/NotFoundPage";
import { NoProfileShell } from "./components/NoProfileShell";
import { Toaster } from "@/components/ui/toaster";
import { FlareProvider } from "@/lib/flare/FlareProvider";
import { IronShell } from "@/lib/iron/IronShell";
import { supabase } from "./lib/supabase";
import {
  hasStoredSupabaseAuthToken,
  shouldShowProtectedRouteBootstrap,
} from "./lib/auth-route-bootstrap";
import { hasCachedAuthProfile } from "./lib/auth-recovery";
import { portalRouteElements } from "./features/portal/PortalRoutes";
import { PortalLoginPage } from "./features/portal/pages/PortalLoginPage";

const ChatPage = lazy(() =>
  import("./components/ChatPage").then((m) => ({ default: m.ChatPage }))
);
const AdminPage = lazy(() =>
  import("./components/AdminPage").then((m) => ({ default: m.AdminPage }))
);
const VoiceCapturePage = lazy(() =>
  import("./components/VoiceCapturePage").then((m) => ({ default: m.VoiceCapturePage }))
);
const VoiceHistoryPage = lazy(() =>
  import("./components/VoiceHistoryPage").then((m) => ({ default: m.VoiceHistoryPage }))
);
const QuoteBuilderPage = lazy(() =>
  import("./components/QuoteBuilderPage").then((m) => ({ default: m.QuoteBuilderPage }))
);
const QuoteBuilderV2Page = lazy(() =>
  import("./features/quote-builder/pages/QuoteBuilderV2Page").then((m) => ({ default: m.QuoteBuilderV2Page }))
);
const DashboardRouter = lazy(() =>
  import("./features/dashboards/pages/DashboardRouter").then((m) => ({ default: m.DashboardRouter }))
);
const ServiceCommandCenterPage = lazy(() =>
  import("./features/service/pages/ServiceCommandCenterPage").then((m) => ({ default: m.ServiceCommandCenterPage }))
);
const ServiceIntakePage = lazy(() =>
  import("./features/service/pages/ServiceIntakePage").then((m) => ({ default: m.ServiceIntakePage }))
);
const PartsWorkQueuePage = lazy(() =>
  import("./features/service/pages/PartsWorkQueuePage").then((m) => ({ default: m.PartsWorkQueuePage }))
);
const FulfillmentRunDetailPage = lazy(() =>
  import("./features/service/pages/FulfillmentRunDetailPage").then((m) => ({
    default: m.FulfillmentRunDetailPage,
  }))
);
const VendorProfilesPage = lazy(() =>
  import("./features/service/pages/VendorProfilesPage").then((m) => ({ default: m.VendorProfilesPage }))
);
const ServiceEfficiencyPage = lazy(() =>
  import("./features/service/pages/ServiceEfficiencyPage").then((m) => ({ default: m.ServiceEfficiencyPage }))
);
const ServiceBranchConfigPage = lazy(() =>
  import("./features/service/pages/ServiceBranchConfigPage").then((m) => ({ default: m.ServiceBranchConfigPage }))
);
const PartsInventoryPage = lazy(() =>
  import("./features/service/pages/PartsInventoryPage").then((m) => ({ default: m.PartsInventoryPage }))
);
const PortalPartsOrdersPage = lazy(() =>
  import("./features/service/pages/PortalPartsOrdersPage").then((m) => ({ default: m.PortalPartsOrdersPage }))
);
const JobCodeSuggestionsPage = lazy(() =>
  import("./features/service/pages/JobCodeSuggestionsPage").then((m) => ({ default: m.JobCodeSuggestionsPage }))
);
const ServiceSchedulerHealthPage = lazy(() =>
  import("./features/service/pages/ServiceSchedulerHealthPage").then((m) => ({
    default: m.ServiceSchedulerHealthPage,
  }))
);
const ServiceShopInvoicePage = lazy(() =>
  import("./features/service/pages/ServiceShopInvoicePage").then((m) => ({
    default: m.ServiceShopInvoicePage,
  }))
);
const ServicePublicTrackPage = lazy(() =>
  import("./features/service/pages/ServicePublicTrackPage").then((m) => ({ default: m.ServicePublicTrackPage }))
);
const IntakeKanbanPage = lazy(() =>
  import("./features/ops/pages/IntakeKanbanPage").then((m) => ({ default: m.IntakeKanbanPage }))
);
const PdiChecklistPage = lazy(() =>
  import("./features/ops/pages/PdiChecklistPage").then((m) => ({ default: m.PdiChecklistPage }))
);
const TrafficTicketsPage = lazy(() =>
  import("./features/ops/pages/TrafficTicketsPage").then((m) => ({ default: m.TrafficTicketsPage }))
);
const RentalReturnsPage = lazy(() =>
  import("./features/ops/pages/RentalReturnsPage").then((m) => ({ default: m.RentalReturnsPage }))
);
const PaymentValidationPage = lazy(() =>
  import("./features/ops/pages/PaymentValidationPage").then((m) => ({ default: m.PaymentValidationPage }))
);
const SopComplianceDashboardPage = lazy(() =>
  import("./features/ops/pages/SopComplianceDashboardPage").then((m) => ({ default: m.SopComplianceDashboardPage }))
);
const DealTimingDashboardPage = lazy(() =>
  import("./features/deal-timing/pages/DealTimingDashboardPage").then((m) => ({ default: m.DealTimingDashboardPage }))
);
const VoiceQrmPage = lazy(() =>
  import("./features/voice-qrm/pages/VoiceQrmPage").then((m) => ({ default: m.VoiceQrmPage }))
);
const NervousSystemDashboardPage = lazy(() =>
  import("./features/nervous-system/pages/NervousSystemDashboardPage").then((m) => ({ default: m.NervousSystemDashboardPage }))
);
const PriceIntelligencePage = lazy(() =>
  import("./features/price-intelligence/pages/PriceIntelligencePage").then((m) => ({ default: m.PriceIntelligencePage }))
);
const SopTemplatesListPage = lazy(() =>
  import("./features/sop/pages/SopTemplatesListPage").then((m) => ({ default: m.SopTemplatesListPage }))
);
const SopTemplateEditorPage = lazy(() =>
  import("./features/sop/pages/SopTemplateEditorPage").then((m) => ({ default: m.SopTemplateEditorPage }))
);
const SopExecutionPage = lazy(() =>
  import("./features/sop/pages/SopExecutionPage").then((m) => ({ default: m.SopExecutionPage }))
);
const EmailDraftInboxPage = lazy(() =>
  import("./features/email-drafts/pages/EmailDraftInboxPage").then((m) => ({ default: m.EmailDraftInboxPage }))
);
const DgeCockpitPage = lazy(() =>
  import("./features/dge/pages/DgeCockpitPage").then((m) => ({ default: m.DgeCockpitPage }))
);
const OperatingSystemHubPage = lazy(() =>
  import("./features/dashboards/pages/OperatingSystemHubPage").then((m) => ({ default: m.OperatingSystemHubPage }))
);
const AssetDetailPage = lazy(() =>
  import("./features/equipment/pages/AssetDetailPage").then((m) => ({ default: m.AssetDetailPage }))
);
const ServiceDashboardPage = lazy(() =>
  import("./features/service/pages/ServiceDashboardPage").then((m) => ({ default: m.ServiceDashboardPage }))
);
const FleetMapPage = lazy(() =>
  import("./features/fleet/pages/FleetMapPage").then((m) => ({ default: m.FleetMapPage }))
);
const DataQualityPage = lazy(() =>
  import("./features/admin/pages/DataQualityPage").then((m) => ({ default: m.DataQualityPage }))
);
const ExceptionInboxPage = lazy(() =>
  import("./features/admin/pages/ExceptionInboxPage").then((m) => ({ default: m.ExceptionInboxPage }))
);
const ExecCommandCenterPage = lazy(() =>
  import("./features/admin/pages/ExecCommandCenterPage").then((m) => ({ default: m.ExecCommandCenterPage }))
);
const IncentiveCatalogPage = lazy(() =>
  import("./features/admin/pages/IncentiveCatalogPage").then((m) => ({ default: m.IncentiveCatalogPage }))
);
const CatalogImportPage = lazy(() =>
  import("./features/admin/pages/CatalogImportPage").then((m) => ({ default: m.CatalogImportPage }))
);
const FleetRadarPage = lazy(() =>
  import("./features/qrm/pages/FleetRadarPage").then((m) => ({ default: m.FleetRadarPage }))
);
const LifecyclePage = lazy(() =>
  import("./features/qrm/pages/LifecyclePage").then((m) => ({ default: m.LifecyclePage }))
);
const TimeBankPage = lazy(() =>
  import("./features/qrm/pages/TimeBankPage").then((m) => ({ default: m.TimeBankPage }))
);
const InventoryPressureBoardPage = lazy(() =>
  import("./features/qrm/pages/InventoryPressureBoardPage").then((m) => ({ default: m.InventoryPressureBoardPage }))
);
const AccountCommandCenterPage = lazy(() =>
  import("./features/qrm/pages/AccountCommandCenterPage").then((m) => ({ default: m.AccountCommandCenterPage }))
);
const BranchCommandCenterPage = lazy(() =>
  import("./features/qrm/pages/BranchCommandCenterPage").then((m) => ({ default: m.BranchCommandCenterPage }))
);
const TerritoryCommandCenterPage = lazy(() =>
  import("./features/qrm/pages/TerritoryCommandCenterPage").then((m) => ({ default: m.TerritoryCommandCenterPage }))
);
const MobileFieldCommandPage = lazy(() =>
  import("./features/qrm/pages/MobileFieldCommandPage").then((m) => ({ default: m.MobileFieldCommandPage }))
);
const VisitIntelligencePage = lazy(() =>
  import("./features/qrm/pages/VisitIntelligencePage").then((m) => ({ default: m.VisitIntelligencePage }))
);
const TradeWalkaroundPage = lazy(() =>
  import("./features/qrm/pages/TradeWalkaroundPage").then((m) => ({ default: m.TradeWalkaroundPage }))
);
const IdeaBacklogPage = lazy(() =>
  import("./features/qrm/pages/IdeaBacklogPage").then((m) => ({ default: m.IdeaBacklogPage }))
);
const PrimitivesPlaygroundPage = lazy(() =>
  import("./features/dev/pages/PrimitivesPlaygroundPage").then((m) => ({ default: m.PrimitivesPlaygroundPage }))
);
const CommandCenterPage = lazy(() =>
  import("./features/exec/pages/CommandCenterPage").then((m) => ({ default: m.CommandCenterPage }))
);
const HandoffTrustLedgerPage = lazy(() =>
  import("./features/exec/pages/HandoffTrustLedgerPage").then((m) => ({ default: m.HandoffTrustLedgerPage }))
);
const FlowAdminPage = lazy(() =>
  import("./features/admin/pages/FlowAdminPage").then((m) => ({ default: m.FlowAdminPage }))
);
const FlareAdminPage = lazy(() =>
  import("./features/admin/pages/FlareAdminPage").then((m) => ({ default: m.FlareAdminPage }))
);
const QuoteBuilderGate = lazy(() =>
  import("./components/QuoteBuilderGate").then((m) => ({ default: m.QuoteBuilderGate }))
);
const RentalLabShowcase = lazy(() =>
  import("./components/RentalLabShowcase").then((m) => ({ default: m.RentalLabShowcase }))
);
const PartsLabShowcase = lazy(() =>
  import("./components/PartsLabShowcase").then((m) => ({ default: m.PartsLabShowcase }))
);
const PartsCommandCenterPage = lazy(() =>
  import("./features/parts/pages/PartsCommandCenterPage").then((m) => ({
    default: m.PartsCommandCenterPage,
  }))
);
const PartsCatalogPage = lazy(() =>
  import("./features/parts/pages/PartsCatalogPage").then((m) => ({ default: m.PartsCatalogPage }))
);
const PartsOrdersPage = lazy(() =>
  import("./features/parts/pages/PartsOrdersPage").then((m) => ({ default: m.PartsOrdersPage }))
);
const NewPartsOrderPage = lazy(() =>
  import("./features/parts/pages/NewPartsOrderPage").then((m) => ({ default: m.NewPartsOrderPage }))
);
const PartsOrderDetailPage = lazy(() =>
  import("./features/parts/pages/PartsOrderDetailPage").then((m) => ({
    default: m.PartsOrderDetailPage,
  }))
);
const PartsFulfillmentPage = lazy(() =>
  import("./features/parts/pages/PartsFulfillmentPage").then((m) => ({
    default: m.PartsFulfillmentPage,
  }))
);
const PartsForecastPage = lazy(() =>
  import("./features/parts/pages/PartsForecastPage").then((m) => ({
    default: m.PartsForecastPage,
  }))
);
const PartsAnalyticsPage = lazy(() =>
  import("./features/parts/pages/PartsAnalyticsPage").then((m) => ({
    default: m.PartsAnalyticsPage,
  }))
);
const LogisticsShowcase = lazy(() =>
  import("./components/LogisticsShowcase").then((m) => ({ default: m.LogisticsShowcase }))
);
const ExecutiveIntelligenceShowcase = lazy(() =>
  import("./components/ExecutiveIntelligenceShowcase").then((m) => ({
    default: m.ExecutiveIntelligenceShowcase,
  }))
);
const CustomerIntelligenceShowcase = lazy(() =>
  import("./components/CustomerIntelligenceShowcase").then((m) => ({
    default: m.CustomerIntelligenceShowcase,
  }))
);
const PeopleOpsShowcase = lazy(() =>
  import("./components/PeopleOpsShowcase").then((m) => ({
    default: m.PeopleOpsShowcase,
  }))
);
const BranchManagementPage = lazy(() =>
  import("./features/admin/pages/BranchManagementPage").then((m) => ({
    default: m.BranchManagementPage,
  }))
);
const IntegrationHub = lazy(() =>
  import("./components/IntegrationHub").then((m) => ({ default: m.IntegrationHub }))
);
const IntegrationCallbackPage = lazy(() =>
  import("./components/IntegrationCallbackPage").then((m) => ({
    default: m.IntegrationCallbackPage,
  }))
);
const HubSpotConnectPage = lazy(() =>
  import("./components/HubSpotConnectPage").then((m) => ({ default: m.HubSpotConnectPage }))
);
const QrmContactsPage = lazy(() =>
  import("./features/qrm/pages/QrmContactsPage").then((m) => ({ default: m.QrmContactsPage }))
);
const QrmContactDetailPage = lazy(() =>
  import("./features/qrm/pages/QrmContactDetailPage").then((m) => ({
    default: m.QrmContactDetailPage,
  }))
);
const QrmCompaniesPage = lazy(() =>
  import("./features/qrm/pages/QrmCompaniesPage").then((m) => ({ default: m.QrmCompaniesPage }))
);
const QrmCompanyDetailPage = lazy(() =>
  import("./features/qrm/pages/QrmCompanyDetailPage").then((m) => ({
    default: m.QrmCompanyDetailPage,
  }))
);
const QrmDealDetailPage = lazy(() =>
  import("./features/qrm/pages/QrmDealDetailPage").then((m) => ({ default: m.QrmDealDetailPage }))
);
const QrmPipelinePage = lazy(() =>
  import("./features/qrm/pages/QrmPipelinePage").then((m) => ({ default: m.QrmPipelinePage }))
);
const QrmDuplicatesPage = lazy(() =>
  import("./features/qrm/pages/QrmDuplicatesPage").then((m) => ({ default: m.QrmDuplicatesPage }))
);
const QrmEquipmentDetailPage = lazy(() =>
  import("./features/qrm/pages/QrmEquipmentDetailPage").then((m) => ({
    default: m.QrmEquipmentDetailPage,
  }))
);
const QrmActivitiesPage = lazy(() =>
  import("./features/qrm/pages/QrmActivitiesPage").then((m) => ({ default: m.QrmActivitiesPage }))
);
const QrmActivityTemplatesPage = lazy(() =>
  import("./features/qrm/pages/QrmActivityTemplatesPage").then((m) => ({
    default: m.QrmActivityTemplatesPage,
  }))
);
const QrmFollowUpSequencesPage = lazy(() =>
  import("./features/qrm/pages/QrmFollowUpSequencesPage").then((m) => ({
    default: m.QrmFollowUpSequencesPage,
  }))
);
const QrmCommandCenterPage = lazy(() =>
  import("./features/qrm/command-center/components/QrmCommandCenterPage").then((m) => ({
    default: m.QrmCommandCenterPage,
  }))
);

const PredictionTracePage = lazy(() =>
  import("./features/qrm/command-center/components/PredictionTracePage").then((m) => ({
    default: m.PredictionTracePage,
  }))
);

const QuoteVelocityCenterPage = lazy(() =>
  import("./features/qrm/command-center/components/QuoteVelocityCenterPage").then((m) => ({
    default: m.QuoteVelocityCenterPage,
  }))
);

const ApprovalCenterPage = lazy(() =>
  import("./features/qrm/command-center/components/ApprovalCenterPage").then((m) => ({
    default: m.ApprovalCenterPage,
  }))
);

const BlockerBoardPage = lazy(() =>
  import("./features/qrm/command-center/components/BlockerBoardPage").then((m) => ({
    default: m.BlockerBoardPage,
  }))
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

const envIntelliDealerConnected = !!import.meta.env.VITE_INTELLIDEALER_URL;

interface IntegrationAvailabilityResponse {
  connected?: boolean;
}

/**
 * Legacy /crm/* redirect helper. The product is QRM now; old bookmarks
 * still work via this catch-all that rewrites the prefix.
 */
function LegacyCrmRedirect() {
  const location = useLocation();
  const next = `/qrm${location.pathname.slice(4)}${location.search}`;
  return <Navigate to={next} replace />;
}

function LegacyCompanyCommandRedirect() {
  const { pathname, search } = useLocation();
  const match = pathname.match(/^\/qrm\/companies\/([^/]+)\/command$/);
  const companyId = match?.[1];
  return companyId
    ? <Navigate to={`/qrm/accounts/${companyId}/command${search}`} replace />
    : <Navigate to="/qrm/companies" replace />;
}

function AnimatedRoutes({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="animate-page-in">
      <Suspense fallback={<RouteFallback />}>
        <Routes location={location}>{children}</Routes>
      </Suspense>
    </div>
  );
}

function App() {
  const { user, profile, loading, error } = useAuth();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const shouldHoldProtectedRouteBootstrap = shouldShowProtectedRouteBootstrap({
    pathname,
    hasStoredToken: hasStoredSupabaseAuthToken(),
    hasCachedProfile: hasCachedAuthProfile(),
    authError: error,
  });
  const [quoteBuilderAccess, setQuoteBuilderAccess] = useState({
    connected: envIntelliDealerConnected,
    loading: true,
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            throwOnError: false,
          },
        },
      })
  );
  const [sessionExpired, setSessionExpired] = useState(false);
  // Track intentional logouts so SIGNED_OUT doesn't show the expired modal
  const isIntentionalLogout = useRef(false);

  // Detect externally-triggered session expiry (token no longer valid)
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED") {
        setSessionExpired(false);
      } else if (event === "SIGNED_OUT" && !isIntentionalLogout.current) {
        // Session expired without deliberate user action — show the expired modal
        setSessionExpired(true);
      }
      if (event === "SIGNED_OUT") {
        isIntentionalLogout.current = false;
      }
    });

    // Belt-and-suspenders: if no valid session exists but a corrupt token
    // is in localStorage, force sign-out now so the modal surfaces even
    // if onAuthStateChange misses it.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        const hasCorruptToken = Object.keys(localStorage).some(
          (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
        );
        if (hasCorruptToken) {
          void supabase.auth.signOut();
        }
      }
    }).catch(() => {});

    return () => subscription.unsubscribe();
  }, []);

  // Derive session-expiry modal visibility directly from auth state so the
  // modal renders on the SAME paint as the login page — no second render
  // cycle needed (the prior useEffect approach required an extra render,
  // creating a window where Playwright sees login without the modal).
  const authErrorIsExpiry = useMemo(() => {
    if (loading || user || !error) return false;
    return /expired|invalid|token|sign in again/i.test(error);
  }, [loading, user, error]);
  const showSessionExpiredModal = sessionExpired || authErrorIsExpiry;

  useEffect(() => {
    if (!user || !profile) {
      setQuoteBuilderAccess({
        connected: envIntelliDealerConnected,
        loading: true,
      });
      return;
    }

    let cancelled = false;

    async function loadQuoteBuilderAccess(): Promise<void> {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          if (!cancelled) {
            setQuoteBuilderAccess({
              connected: envIntelliDealerConnected,
              loading: false,
            });
          }
          return;
        }

        const { data, error: invokeError } =
          await supabase.functions.invoke<IntegrationAvailabilityResponse>(
            "integration-availability",
            {
              body: { integration_key: "intellidealer" },
              headers: {
                Authorization: `Bearer ${session.access_token}`,
              },
            }
          );

        if (cancelled) return;

        if (invokeError || typeof data?.connected !== "boolean") {
          setQuoteBuilderAccess({
            connected: envIntelliDealerConnected,
            loading: false,
          });
          return;
        }

        setQuoteBuilderAccess({
          connected: data.connected,
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setQuoteBuilderAccess({
            connected: envIntelliDealerConnected,
            loading: false,
          });
        }
      }
    }

    void loadQuoteBuilderAccess();

    return () => {
      cancelled = true;
    };
  }, [user?.id, profile?.id]);

  if (loading) {
    return (
      <>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div
            className="text-center"
            role="status"
            aria-label="Loading application"
          >
            <div
              className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
        <Toaster />
      </>
    );
  }

  if (!user && shouldHoldProtectedRouteBootstrap) {
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <OfflineBanner />
          <SessionExpiredModal
            open={showSessionExpiredModal}
            onSignIn={() => {
              setSessionExpired(false);
            }}
          />
          <div className="min-h-screen bg-background flex items-center justify-center px-6">
            <div className="text-center max-w-md" role="status" aria-live="polite">
              <div
                className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">Finishing sign-in...</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {error ?? "We're restoring your workspace access for this page."}
              </p>
            </div>
          </div>
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    );
  }

  if (!user) {
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <OfflineBanner />
          <Suspense
            fallback={
              <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <Routes>
              <Route path="/service/track" element={<ServicePublicTrackPage />} />
              <Route path="/portal/login" element={<PortalLoginPage authError={error} />} />
              <Route path="/portal/*" element={<Navigate to="/portal/login" replace />} />
              <Route path="*" element={<LoginPage authError={error} />} />
            </Routes>
          </Suspense>
          <SessionExpiredModal
            open={showSessionExpiredModal}
            onSignIn={() => setSessionExpired(false)}
          />
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    );
  }

  if (!profile) {
    return (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionExpiredModal
            open={showSessionExpiredModal}
            onSignIn={() => {
              setSessionExpired(false);
              void supabase.auth.signOut();
            }}
          />
          <NoProfileShell authError={error} />
        </BrowserRouter>
      </QueryClientProvider>
    );
  }

  async function handleLogout() {
    isIntentionalLogout.current = true;
    await supabase.auth.signOut();
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppErrorBoundary>
          <FlareProvider>
          <OfflineBanner />
          <SessionExpiredModal
            open={showSessionExpiredModal}
            onSignIn={() => {
              setSessionExpired(false);
              void supabase.auth.signOut();
            }}
          />
          <AppLayout
            profile={profile}
            onLogout={handleLogout}
            quoteBuilderEnabled={quoteBuilderAccess.connected}
            quoteBuilderLoading={quoteBuilderAccess.loading}
          >
            <AnimatedRoutes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route
                path="/dashboard"
                element={
                  <DashboardRouter
                    userId={profile.id}
                    userRole={profile.role}
                    ironRoleFromProfile={profile.iron_role}
                  />
                }
              />
              <Route
                path="/dashboard/classic"
                element={
                  <DashboardPage
                    userId={profile.id}
                    userRole={profile.role}
                    userEmail={profile.email}
                    userName={profile.full_name}
                  />
                }
              />
              <Route
                path="/chat"
                element={
                  <ChatPage userRole={profile.role} userEmail={profile.email} />
                }
              />
              <Route
                path="/admin"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <AdminPage userRole={profile.role} userId={profile.id} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/auth/onedrive/callback"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <IntegrationCallbackPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/auth/hubspot/connect"
                element={
                  ["admin", "owner"].includes(profile.role) ? (
                    <HubSpotConnectPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/voice"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <VoiceCapturePage
                      userRole={profile.role}
                      userEmail={profile.email}
                    />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/voice/history"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <VoiceHistoryPage userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/quote"
                element={
                  ["rep", "manager", "owner"].includes(profile.role) ? (
                    <Navigate to="/quote-v2" replace />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/quote-v2"
                element={
                  ["rep", "manager", "owner"].includes(profile.role) ? (
                    <QuoteBuilderV2Page />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              {/* Service Engine routes */}
              <Route
                path="/service"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <ServiceCommandCenterPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/intake"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <ServiceIntakePage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/parts"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <PartsWorkQueuePage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/fulfillment/:runId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <FulfillmentRunDetailPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/portal-parts"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <PortalPartsOrdersPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/vendors"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <VendorProfilesPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/efficiency"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <ServiceEfficiencyPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/branches"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <ServiceBranchConfigPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/inventory"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <PartsInventoryPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/job-code-suggestions"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <JobCodeSuggestionsPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/scheduler-health"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <ServiceSchedulerHealthPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/invoice/:invoiceId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <ServiceShopInvoicePage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route path="/service/track" element={<ServicePublicTrackPage />} />
              <Route
                path="/ops/intake"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <IntakeKanbanPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/ops/intake/:intakeId/pdi"
                element={
                  ["admin", "manager", "owner", "rep"].includes(profile.role) ? (
                    <PdiChecklistPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/ops/traffic"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <TrafficTicketsPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/ops/returns"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <RentalReturnsPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/ops/payments"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <PaymentValidationPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/ops/sop-compliance"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <SopComplianceDashboardPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/deal-timing"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <DealTimingDashboardPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/voice-qrm"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <VoiceQrmPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/m/qrm"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <MobileFieldCommandPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/visit-intelligence"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <VisitIntelligencePage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/deals/:dealId/trade-walkaround"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <TradeWalkaroundPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/nervous-system"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <NervousSystemDashboardPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/price-intelligence"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <PriceIntelligencePage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/sop/templates"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <SopTemplatesListPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/sop/templates/:templateId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <SopTemplateEditorPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/sop/executions/:executionId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <SopExecutionPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/os"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <OperatingSystemHubPage userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/email-drafts"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <EmailDraftInboxPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/dge/cockpit"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <DgeCockpitPage userId={profile.id} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/equipment/:equipmentId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <AssetDetailPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/service/dashboard"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <ServiceDashboardPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/fleet"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <FleetMapPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/data-quality"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <DataQualityPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/exceptions"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <ExceptionInboxPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/exec"
                element={
                  ["owner", "manager"].includes(profile.role) ? (
                    <Navigate to="/executive" replace />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/incentives"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <IncentiveCatalogPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/catalog-import"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <CatalogImportPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/rentals"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <RentalLabShowcase />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/lab"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsLabShowcase />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/catalog"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsCatalogPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/orders/new"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <NewPartsOrderPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/orders/:id"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsOrderDetailPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/orders"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsOrdersPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/fulfillment/:runId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <FulfillmentRunDetailPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/fulfillment"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsFulfillmentPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/forecast"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsForecastPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/analytics"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsAnalyticsPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/inventory"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsInventoryPage subNav="parts" />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts/vendors"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <VendorProfilesPage subNav="parts" />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/parts"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <Suspense fallback={<RouteFallback />}>
                      <PartsCommandCenterPage />
                    </Suspense>
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/logistics"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <LogisticsShowcase />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/executive"
                element={
                  ["manager", "owner"].includes(profile.role) ? (
                    <CommandCenterPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/executive/summary"
                element={
                  ["manager", "owner"].includes(profile.role) ? (
                    <Navigate to="/executive" replace />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/executive/vision"
                element={
                  ["manager", "owner"].includes(profile.role) ? (
                    <ExecutiveIntelligenceShowcase />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/executive/handoffs"
                element={
                  ["manager", "owner"].includes(profile.role) ? (
                    <HandoffTrustLedgerPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/customers"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CustomerIntelligenceShowcase />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/people"
                element={
                  ["manager", "owner"].includes(profile.role) ? (
                    <PeopleOpsShowcase />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              {/* QRM Command Center — canonical route. Legacy QrmHubPage deleted in cutover. */}
              <Route
                path="/qrm"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmCommandCenterPage userRole={profile.role} userId={profile.id} userName={profile.full_name} userEmail={profile.email} ironRoleFromProfile={profile.iron_role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              {/* /qrm/command bookmark redirect → /qrm (cutover alias) */}
              <Route path="/qrm/command" element={<Navigate to="/qrm" replace />} />
              {/* Slice 1.3 — Quote Velocity Center drill-down */}
              <Route
                path="/qrm/command/quotes"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QuoteVelocityCenterPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route path="/qrm/command/time-bank" element={<Navigate to="/qrm/time-bank" replace />} />
              {/* Slice 1.4 — Approval Center (manager-gated) */}
              <Route
                path="/qrm/command/approvals"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <ApprovalCenterPage />
                  ) : (
                    <Navigate to="/qrm" replace />
                  )
                }
              />
              {/* Slice 1.5 — Blocker Board */}
              <Route
                path="/qrm/command/blockers"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <BlockerBoardPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              {/* Phase 0 P0.8 — Prediction trace viewer (manager-gated) */}
              <Route
                path="/qrm/command/trace/:predictionId"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <PredictionTracePage />
                  ) : (
                    <Navigate to="/qrm" replace />
                  )
                }
              />
              {/* Legacy /crm/* bookmark catch-all → /qrm/* */}
              <Route path="/crm" element={<Navigate to="/qrm" replace />} />
              <Route path="/crm/*" element={<LegacyCrmRedirect />} />
              <Route
                path="/qrm/activities"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmActivitiesPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/templates"
                element={<Navigate to="/admin/templates" replace />}
              />
              <Route
                path="/qrm/sequences"
                element={<Navigate to="/admin/sequences" replace />}
              />
              <Route
                path="/qrm/deals"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmPipelinePage userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route path="/qrm/pipeline" element={<Navigate to="/qrm/deals" replace />} />
              <Route
                path="/qrm/contacts"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmContactsPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/contacts/:contactId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmContactDetailPage userId={profile.id} userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/deals/:dealId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmDealDetailPage userId={profile.id} userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/accounts/:accountId/command"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <AccountCommandCenterPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/branches/:branchId/command"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <BranchCommandCenterPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/territories/:territoryId/command"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <TerritoryCommandCenterPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route path="/qrm/companies/:companyId/command" element={<LegacyCompanyCommandRedirect />} />
              <Route
                path="/qrm/companies"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmCompaniesPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/companies/:companyId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmCompanyDetailPage userId={profile.id} userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/companies/:companyId/fleet-radar"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <FleetRadarPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/companies/:companyId/lifecycle"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <LifecyclePage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/time-bank"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <TimeBankPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/inventory-pressure"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <InventoryPressureBoardPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/ideas"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <IdeaBacklogPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/dev/primitives"
                element={
                  ["admin", "owner"].includes(profile.role) ? (
                    <PrimitivesPlaygroundPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/executive/live"
                element={
                  ["manager", "owner"].includes(profile.role) ? (
                    <Navigate to="/executive" replace />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/flow"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <FlowAdminPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/flare"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <FlareAdminPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/flare/:reportId"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <FlareAdminPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/equipment/:equipmentId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmEquipmentDetailPage userId={profile.id} userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/qrm/duplicates"
                element={<Navigate to="/admin/duplicates" replace />}
              />
              <Route
                path="/admin/templates"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmActivityTemplatesPage userId={profile.id} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/sequences"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmFollowUpSequencesPage userId={profile.id} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/duplicates"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <QrmDuplicatesPage userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/branches"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <BranchManagementPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/admin/integrations"
                element={
                  ["admin", "owner"].includes(profile.role) ? (
                    <IntegrationHub actorUserId={profile.id} userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              {/* Branded 404 for unknown routes */}
              {/* Customer Portal routes */}
              {portalRouteElements()}

              <Route path="*" element={<NotFoundPage />} />
            </AnimatedRoutes>
          </AppLayout>
          <IronShell />
          </FlareProvider>
        </AppErrorBoundary>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
