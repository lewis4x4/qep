import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./components/LoginPage";
import { ChatPage } from "./components/ChatPage";
import { AdminPage } from "./components/AdminPage";
import { VoiceCapturePage } from "./components/VoiceCapturePage";
import { QuoteBuilderPage } from "./components/QuoteBuilderPage";

function App() {
  const { user, profile, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return <LoginPage authError={error} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<ChatPage userRole={profile.role} userEmail={profile.email} />}
        />
        <Route
          path="/admin"
          element={
            ["admin", "manager", "owner"].includes(profile.role)
              ? <AdminPage userRole={profile.role} userId={profile.id} />
              : <Navigate to="/" replace />
          }
        />
        <Route
          path="/voice"
          element={
            ["rep", "admin", "manager", "owner"].includes(profile.role)
              ? <VoiceCapturePage userRole={profile.role} userEmail={profile.email} />
              : <Navigate to="/" replace />
          }
        />
        <Route
          path="/quote"
          element={
            ["rep", "manager", "owner"].includes(profile.role)
              ? (
                <QuoteBuilderPage
                  userRole={profile.role}
                  userEmail={profile.email}
                  repName={profile.full_name}
                />
              )
              : <Navigate to="/" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
