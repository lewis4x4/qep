import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { DataSourceBadge, type DataSourceState } from "@/components/DataSourceBadge";
import { hubspotAdminSupabase } from "@/lib/hubspot-admin-supabase";
import { supabase } from "@/lib/supabase";
import { trackIntegrationEvent } from "@/lib/track-event";

interface QrmPageHeaderProps {
  title: string;
  subtitle: string;
}

interface HubSpotIntegrationStatusRow {
  status: "connected" | "pending_credentials" | "error" | "demo_mode";
  last_sync_at: string | null;
}

const STALE_SYNC_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1_000;

function mapHubSpotStatusToBadge(
  status: HubSpotIntegrationStatusRow["status"],
  lastSyncAt: string | null
): DataSourceState {
  if (status === "error") return "Error";
  if (status === "demo_mode") return "Demo";
  if (status === "pending_credentials") return "Manual";
  if (lastSyncAt) {
    const isStale = Date.now() - new Date(lastSyncAt).getTime() > STALE_SYNC_THRESHOLD_MS;
    if (isStale) return "Stale";
  }
  return "Live";
}

async function fetchCrmDataSourceState(): Promise<DataSourceState> {
  const { data: integrationStatus, error: integrationError } = await supabase
    .from("integration_status")
    .select("status, last_sync_at")
    .eq("integration_key", "hubspot")
    .maybeSingle();

  if (!integrationError && integrationStatus) {
    const row = integrationStatus as HubSpotIntegrationStatusRow;
    return mapHubSpotStatusToBadge(row.status, row.last_sync_at);
  }

  const { data: activePortalRows, error: portalError } = await hubspotAdminSupabase
    .from("workspace_hubspot_portal")
    .select("id")
    .eq("workspace_id", "default")
    .eq("is_active", true)
    .limit(1);

  if (!portalError && (activePortalRows?.length ?? 0) > 0) {
    return "Live";
  }

  return "Demo";
}

export function QrmPageHeader({ title, subtitle }: QrmPageHeaderProps) {
  const dataSourceQuery = useQuery({
    queryKey: ["crm", "hubspot-data-source-state"],
    queryFn: fetchCrmDataSourceState,
    staleTime: 60_000,
  });

  const dataSourceState = dataSourceQuery.data ?? "Demo";

  useEffect(() => {
    if (!dataSourceState) return;
    void trackIntegrationEvent("integration_badge_rendered", {
      integration_key: "hubspot",
      data_mode: dataSourceState.toLowerCase(),
      surface: "crm_header",
    });
  }, [dataSourceState]);

  return (
    <header className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-8 text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="self-start sm:self-auto">
          <DataSourceBadge state={dataSourceState} />
        </div>
      </div>
    </header>
  );
}
