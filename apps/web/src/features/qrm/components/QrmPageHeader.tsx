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
import {
  IronBar,
  MetricStrip,
  SectionCrumb,
  type IronBarAction,
} from "./command-deck";
import type { MetricCell } from "./command-deck";

interface QrmPageHeaderProps {
  title: string;
  subtitle: string;
  /**
   * Optional monospaced surface/lens crumb, e.g. { surface: "GRAPH", lens: "CONTACTS", count: 847 }.
   * When supplied, replaces the default generic `QRM / OPERATOR DECK` eyebrow.
   */
  crumb?: {
    surface: string;
    lens?: string;
    count?: number | string;
  };
  /**
   * Optional metric cells rendered as a horizontal rail beneath the header.
   * Keep to 3–5 cells so the rail reads as a single scan-line.
   */
  metrics?: React.ComponentProps<typeof MetricCell>[];
  /**
   * Optional AI briefing — the pinned "Iron" ribbon at the top of the page.
   * Callers pass a short narrative + 1–2 actions. When null, the ribbon is
   * hidden entirely.
   */
  ironBriefing?: {
    headline: React.ReactNode;
    actions?: IronBarAction[];
  } | null;
  /**
   * Optional right-side action rail (buttons, toggles, etc.).
   */
  rightRail?: React.ReactNode;
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

export function QrmPageHeader({
  title,
  subtitle,
  crumb,
  metrics,
  ironBriefing,
  rightRail,
}: QrmPageHeaderProps) {
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
      {/* Iron briefing ribbon — the AI narrative that frames the page */}
      {ironBriefing && (
        <IronBar headline={ironBriefing.headline} actions={ironBriefing.actions} />
      )}

      {/* Title block */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {crumb ? (
            <SectionCrumb
              surface={crumb.surface}
              lens={crumb.lens}
              count={crumb.count}
              className="mb-1.5"
            />
          ) : (
            <SectionCrumb surface="QRM" lens="Operator Deck" className="mb-1.5" />
          )}
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
          {rightRail}
          {renderStatusIndicator()}
        </div>
      </div>

      {/* Metric strip */}
      {metrics && metrics.length > 0 && <MetricStrip cells={metrics} />}
    </header>
  );
}
