import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

interface ConnectState {
  phase: "retired";
  message: string;
}

export function HubSpotConnectPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<ConnectState>({
    phase: "retired",
    message: "HubSpot is no longer a live dependency. QRM is the active CRM system of record.",
  });

  useEffect(() => {
    void supabase.auth.getSession();
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

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => navigate("/admin/integrations", { replace: true })}
            className="rounded-lg bg-qep-orange px-4 py-2 text-sm font-medium text-white transition hover:bg-qep-orange-hover"
          >
            Return to integrations
          </button>
        </div>
      </div>
    </div>
  );
}
