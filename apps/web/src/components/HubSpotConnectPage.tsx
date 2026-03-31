import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

interface ConnectState {
  phase: "loading" | "error";
  message: string;
}

export function HubSpotConnectPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<ConnectState>({
    phase: "loading",
    message: "Preparing secure HubSpot authorization...",
  });

  useEffect(() => {
    let cancelled = false;

    async function startConnection() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error("Please sign in again before connecting HubSpot.");
        }

        const form = document.createElement("form");
        form.method = "POST";
        form.action = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hubspot-oauth`;
        form.style.display = "none";

        const tokenInput = document.createElement("input");
        tokenInput.type = "hidden";
        tokenInput.name = "session_token";
        tokenInput.value = session.access_token;
        form.appendChild(tokenInput);

        document.body.appendChild(form);
        form.submit();
      } catch (error) {
        if (cancelled) return;
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "Could not start HubSpot authorization.",
        });
      }
    }

    void startConnection();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-qep-orange">
          <span className="text-lg font-bold text-white">HS</span>
        </div>
        <h1 className="mt-5 text-center text-2xl font-semibold text-foreground">
          HubSpot connection
        </h1>
        <p className="mt-3 text-center text-sm leading-6 text-muted-foreground">
          {state.message}
        </p>

        {state.phase === "loading" ? (
          <div className="mt-6 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-qep-orange border-t-transparent" />
          </div>
        ) : (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => navigate("/admin/integrations", { replace: true })}
              className="rounded-lg bg-qep-orange px-4 py-2 text-sm font-medium text-white transition hover:bg-qep-orange-hover"
            >
              Return to integrations
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
