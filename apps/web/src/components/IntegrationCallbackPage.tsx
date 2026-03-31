import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

interface CallbackState {
  phase: "loading" | "success" | "error";
  message: string;
}

export function IntegrationCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<CallbackState>({
    phase: "loading",
    message: "Finalizing your OneDrive connection...",
  });

  useEffect(() => {
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");
    const code = searchParams.get("code");

    if (error) {
      setState({
        phase: "error",
        message: errorDescription || "Authorization failed for OneDrive.",
      });
      return;
    }

    if (!code) {
      setState({
        phase: "error",
        message: "No authorization code received from OneDrive.",
      });
      return;
    }

    const authCode = code;

    let cancelled = false;

    async function finishConnection() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error("Please sign in again before connecting an integration.");
        }

        const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onedrive-oauth`);
        url.searchParams.set("code", authCode);
        url.searchParams.set("mode", "json");

        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || "Failed to connect OneDrive.");
        }

        if (cancelled) return;

        setState({
          phase: "success",
          message: "OneDrive connected successfully.",
        });

        window.setTimeout(() => {
          navigate("/admin/integrations?onedrive=connected", { replace: true });
        }, 1200);
      } catch (callbackError) {
        if (cancelled) return;
        setState({
          phase: "error",
          message: callbackError instanceof Error ? callbackError.message : "Connection failed.",
        });
      }
    }

    void finishConnection();

    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600">
          <span className="text-lg font-bold text-white">Q</span>
        </div>
        <h1 className="mt-5 text-center text-2xl font-semibold text-gray-900">
          OneDrive connection
        </h1>
        <p className="mt-3 text-center text-sm leading-6 text-gray-500">
          {state.message}
        </p>

        {state.phase === "loading" && (
          <div className="mt-6 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        )}

        {state.phase !== "loading" && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => navigate("/admin/integrations", { replace: true })}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Return to admin
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
