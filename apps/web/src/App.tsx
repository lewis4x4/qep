import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./components/LoginPage";
import { AppLayout } from "./components/AppLayout";
import { DashboardPage } from "./components/DashboardPage";
import { ChatPage } from "./components/ChatPage";
import { AdminPage } from "./components/AdminPage";
import { VoiceCapturePage } from "./components/VoiceCapturePage";
import { QuoteBuilderPage } from "./components/QuoteBuilderPage";
import { supabase } from "./lib/supabase";

function App() {
  const { user, profile, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <LoginPage authError={error} />;
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <BrowserRouter>
      <AppLayout profile={profile} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <DashboardPage
                userRole={profile.role}
                userEmail={profile.email}
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
                <QuoteBuilderPage
                  userRole={profile.role}
                  userEmail={profile.email}
                  repName={profile.full_name}
                />
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}

export default App;
