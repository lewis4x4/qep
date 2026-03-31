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
import { Toaster } from "@/components/ui/toaster";
import { supabase } from "./lib/supabase";

const ChatPage = lazy(() =>
  import("./components/ChatPage").then((m) => ({ default: m.ChatPage }))
);
const AdminPage = lazy(() =>
  import("./components/AdminPage").then((m) => ({ default: m.AdminPage }))
);
const VoiceCapturePage = lazy(() =>
  import("./components/VoiceCapturePage").then((m) => ({ default: m.VoiceCapturePage }))
);
const QuoteBuilderPage = lazy(() =>
  import("./components/QuoteBuilderPage").then((m) => ({ default: m.QuoteBuilderPage }))
);
const QuoteBuilderGate = lazy(() =>
  import("./components/QuoteBuilderGate").then((m) => ({ default: m.QuoteBuilderGate }))
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
const CrmContactsPage = lazy(() =>
  import("./features/crm/pages/CrmContactsPage").then((m) => ({ default: m.CrmContactsPage }))
);
const CrmContactDetailPage = lazy(() =>
  import("./features/crm/pages/CrmContactDetailPage").then((m) => ({
    default: m.CrmContactDetailPage,
  }))
);
const CrmCompaniesPage = lazy(() =>
  import("./features/crm/pages/CrmCompaniesPage").then((m) => ({ default: m.CrmCompaniesPage }))
);
const CrmCompanyDetailPage = lazy(() =>
  import("./features/crm/pages/CrmCompanyDetailPage").then((m) => ({
    default: m.CrmCompanyDetailPage,
  }))
);
const CrmDealDetailPage = lazy(() =>
  import("./features/crm/pages/CrmDealDetailPage").then((m) => ({ default: m.CrmDealDetailPage }))
);
const CrmPipelinePage = lazy(() =>
  import("./features/crm/pages/CrmPipelinePage").then((m) => ({ default: m.CrmPipelinePage }))
);
const CrmDuplicatesPage = lazy(() =>
  import("./features/crm/pages/CrmDuplicatesPage").then((m) => ({ default: m.CrmDuplicatesPage }))
);
const CrmActivitiesPage = lazy(() =>
  import("./features/crm/pages/CrmActivitiesPage").then((m) => ({ default: m.CrmActivitiesPage }))
);
const CrmActivityTemplatesPage = lazy(() =>
  import("./features/crm/pages/CrmActivityTemplatesPage").then((m) => ({
    default: m.CrmActivityTemplatesPage,
  }))
);
const CrmFollowUpSequencesPage = lazy(() =>
  import("./features/crm/pages/CrmFollowUpSequencesPage").then((m) => ({
    default: m.CrmFollowUpSequencesPage,
  }))
);
const CrmHubPage = lazy(() =>
  import("./features/crm/pages/CrmHubPage").then((m) => ({ default: m.CrmHubPage }))
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
    });

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
        const { data, error: invokeError } =
          await supabase.functions.invoke<IntegrationAvailabilityResponse>(
            "integration-availability",
            {
              body: { integration_key: "intellidealer" },
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

  if (!user || !profile) {
    return (
      <>
        <OfflineBanner />
        <LoginPage authError={error} />
        <SessionExpiredModal
          open={showSessionExpiredModal}
          onSignIn={() => setSessionExpired(false)}
        />
        <Toaster />
      </>
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
                  <DashboardPage
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
                path="/quote"
                element={
                  ["rep", "manager", "owner"].includes(profile.role) ? (
                    quoteBuilderAccess.loading ? (
                      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-6">
                        <div
                          className="text-center"
                          role="status"
                          aria-label="Checking Quote Builder availability"
                        >
                          <div
                            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"
                            aria-hidden="true"
                          />
                          <p className="text-sm text-muted-foreground">
                            Checking Quote Builder availability...
                          </p>
                        </div>
                      </div>
                    ) : quoteBuilderAccess.connected ? (
                      <QuoteBuilderPage
                        userRole={profile.role}
                        userEmail={profile.email}
                        repName={profile.full_name}
                      />
                    ) : (
                      <QuoteBuilderGate />
                    )
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmHubPage userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/activities"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmActivitiesPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/templates"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmActivityTemplatesPage userId={profile.id} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/sequences"
                element={
                  ["admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmFollowUpSequencesPage userId={profile.id} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/deals"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmPipelinePage userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route path="/crm/pipeline" element={<Navigate to="/crm/deals" replace />} />
              <Route
                path="/crm/contacts"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmContactsPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/contacts/:contactId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmContactDetailPage userId={profile.id} userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/deals/:dealId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmDealDetailPage userId={profile.id} userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/companies"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmCompaniesPage />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/companies/:companyId"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmCompanyDetailPage userId={profile.id} userRole={profile.role} />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/crm/duplicates"
                element={
                  ["rep", "admin", "manager", "owner"].includes(profile.role) ? (
                    <CrmDuplicatesPage userRole={profile.role} />
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
              <Route path="*" element={<NotFoundPage />} />
            </AnimatedRoutes>
          </AppLayout>
        </AppErrorBoundary>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
