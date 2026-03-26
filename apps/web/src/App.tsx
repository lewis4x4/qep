import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./components/LoginPage";
import { ChatPage } from "./components/ChatPage";
import { AdminPage } from "./components/AdminPage";

function App() {
  const { user, profile, loading } = useAuth();

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
    return <LoginPage />;
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
              ? <AdminPage userRole={profile.role} />
              : <Navigate to="/" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
