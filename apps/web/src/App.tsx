import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./components/LoginPage";
import { AppLayout } from "./components/AppLayout";
import { DashboardPage } from "./components/DashboardPage";
import { ChatPage } from "./components/ChatPage";
import { AdminPage } from "./components/AdminPage";
import { VoiceCapturePage } from "./components/VoiceCapturePage";
import { QuoteBuilderPage } from "./components/QuoteBuilderPage";
import { QuoteBuilderGate } from "./components/QuoteBuilderGate";
import { NotFoundPage } from "./components/NotFoundPage";
import { OfflineBanner } from "./components/OfflineBanner";
import { SessionExpiredModal } from "./components/SessionExpiredModal";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { Toaster } from "@/components/ui/toaster";
import { supabase } from "./lib/supabase";

const isIntelliDealerConnected = !!import.meta.env.VITE_INTELLIDEALER_URL;

function AnimatedRoutes({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="animate-page-in">
      <Routes location={location}>{children}</Routes>
    </div>
  );
}

function App() {
  const { user, profile, loading, error } = useAuth();
  const [sessionExpired, setSessionExpired] = useState(false);

  // Detect externally-triggered session expiry (token no longer valid)
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED") {
        setSessionExpired(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // If auth error looks like an expiry, surface the modal instead of a silent redirect
  useEffect(() => {
    if (!loading && !user && error) {
      const msg = error.toLowerCase();
      if (msg.includes("expired") || msg.includes("invalid") || msg.includes("token")) {
        setSessionExpired(true);
      }
    }
  }, [loading, user, error]);

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
          open={sessionExpired}
          onSignIn={() => setSessionExpired(false)}
        />
        <Toaster />
      </>
    );
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <OfflineBanner />
        <SessionExpiredModal
          open={sessionExpired}
          onSignIn={() => {
            setSessionExpired(false);
            void supabase.auth.signOut();
          }}
        />
        <AppLayout profile={profile} onLogout={handleLogout}>
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
                  isIntelliDealerConnected ? (
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
            {/* Branded 404 for unknown routes */}
            <Route path="*" element={<NotFoundPage />} />
          </AnimatedRoutes>
        </AppLayout>
      </AppErrorBoundary>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
