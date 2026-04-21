import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { DataSourceBadge, type DataSourceState } from "@/components/DataSourceBadge";
import { hubspotAdminSupabase } from "@/lib/hubspot-admin-supabase";
import { supabase } from "@/lib/supabase";
import { trackIntegrationEvent } from "@/lib/track-event";
import {
  PulseSparkline,
  pulseFromLastSync,
  synthesizeSyncPulsePoints,
} from "./PulseSparkline";

interface QrmPageHeaderProps {
  title: string;
  subtitle: string;
}

interface HubSpotIntegrationStatusRow {
  status: "connected" | "pending_credentials" | "error" | "demo_mode";
  last_sync_at: string | null;
}

interface CrmDataSourceSnapshot {
  state: DataSourceState;
  lastSyncAt: string | null;
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

async function fetchCrmDataSource(): Promise<CrmDataSourceSnapshot> {
  const { data: integrationStatus, error: integrationError } = await supabase
    .from("integration_status")
    .select("status, last_sync_at")
    .eq("integration_key", "hubspot")
    .maybeSingle();

  if (!integrationError && integrationStatus) {
    const row = integrationStatus as HubSpotIntegrationStatusRow;
    return {
      state: mapHubSpotStatusToBadge(row.status, row.last_sync_at),
      lastSyncAt: row.last_sync_at,
    };
  }

  const { data: activePortalRows, error: portalError } = await hubspotAdminSupabase
    .from("workspace_hubspot_portal")
    .select("id")
    .eq("workspace_id", "default")
    .eq("is_active", true)
    .limit(1);

  if (!portalError && (activePortalRows?.length ?? 0) > 0) {
    return { state: "Live", lastSyncAt: null };
  }

  return { state: "Demo", lastSyncAt: null };
}

export function QrmPageHeader({ title, subtitle }: QrmPageHeaderProps) {
  const dataSourceQuery = useQuery({
    queryKey: ["crm", "hubspot-data-source-state"],
    queryFn: fetchCrmDataSource,
    staleTime: 60_000,
  });

  const snapshot = dataSourceQuery.data ?? { state: "Demo" as DataSourceState, lastSyncAt: null };
  const dataSourceState = snapshot.state;
  const lastSyncAt = snapshot.lastSyncAt;

  useEffect(() => {
    if (!dataSourceState) return;
    void trackIntegrationEvent("integration_badge_rendered", {
      integration_key: "hubspot",
      data_mode: dataSourceState.toLowerCase(),
      surface: "crm_header",
    });
  }, [dataSourceState]);

  // When the data is "Stale", replace the cold yellow pill with a pulse
  // sparkline that communicates "this pulse is fading" instead of shouting
  // a static label. Other states keep the pill for now; Slice 3 replaces
  // every one of them with a signal-backed pulse.
  const renderStatusIndicator = () => {
    if (dataSourceState === "Stale") {
      const pulse = pulseFromLastSync(lastSyncAt);
      const points = synthesizeSyncPulsePoints(lastSyncAt);
      return (
        <span
          className="inline-flex items-center gap-2"
          title={`Data last synced ${pulse.label}. Refresh from Integration Hub to bring it back live.`}
        >
          <PulseSparkline
            points={points}
            intent={pulse.intent}
            label={pulse.label}
            aria-label={`CRM data pulse — last synced ${pulse.label}`}
          />
        </span>
      );
    }
    return <DataSourceBadge state={dataSourceState} />;
  };

  return (
    <header className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-8 text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="self-start sm:self-auto">{renderStatusIndicator()}</div>
      </div>
    </header>
  );
}
