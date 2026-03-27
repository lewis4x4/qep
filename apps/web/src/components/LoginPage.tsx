import { useState } from "react";
import { supabase } from "../lib/supabase";

interface LoginPageProps {
  authError?: string | null;
}

export function LoginPage({ authError }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [mode, setMode] = useState<"password" | "magic">("password");

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setError(error.message);
    else setMagicLinkSent(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <span className="text-white text-2xl font-bold">Q</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">QEP Knowledge Assistant</h1>
          <p className="text-gray-500 mt-1 text-sm">Sign in to access company resources</p>
        </div>

        {authError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <p className="text-red-800 text-sm font-medium">Sign-in problem</p>
            <p className="text-red-600 text-sm mt-1">{authError}</p>
          </div>
        )}

        {magicLinkSent ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <p className="text-green-800 font-medium">Check your email</p>
            <p className="text-green-600 text-sm mt-1">We sent a login link to {email}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setMode("password")}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${
                  mode === "password"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Password
              </button>
              <button
                onClick={() => setMode("magic")}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${
                  mode === "magic"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Magic Link
              </button>
            </div>

            <form onSubmit={mode === "password" ? handlePasswordLogin : handleMagicLink}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@qepusa.com"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {mode === "password" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                )}

                {error && (
                  <p className="text-red-600 text-sm">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {loading ? "Signing in..." : mode === "password" ? "Sign In" : "Send Magic Link"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
