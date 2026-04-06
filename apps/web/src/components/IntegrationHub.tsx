/**
 * IntegrationHub — Admin Integration Hub page at /admin/integrations.
 * Card grid layout per CDO design direction.
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import type { PostgrestError } from "@supabase/supabase-js";
import { AlertTriangle, CheckCircle2, Clock, Wifi, Settings } from "lucide-react";
import { IntegrationCard } from "./IntegrationCard";
import { IntegrationPanel } from "./IntegrationPanel";
import { supabase } from "@/lib/supabase";
import { hubspotAdminSupabase } from "@/lib/hubspot-admin-supabase";
import { cn } from "@/lib/utils";
import { trackIntegrationEvent } from "@/lib/track-event";
import type { UserRole } from "@/lib/database.types";
import { BRAND_NAME } from "@/components/BrandLogo";

export interface IntegrationCardConfig {
  key: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  status: "connected" | "pending_credentials" | "error" | "demo_mode";
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncRecords: number | null;
  endpointUrl: string | null;
  config: Record<string, unknown>;
}

interface IntegrationHubProps {
  actorUserId: string;
  userRole: UserRole;
}

export interface HubSpotImportRunSummary {
  id: string;
  initiatedBy: string | null;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  contactsProcessed: number;
  companiesProcessed: number;
  dealsProcessed: number;
  activitiesProcessed: number;
  errorCount: number;
  errorSummary: string | null;
}

export interface HubSpotImportErrorSummary {
  id: string;
  runId: string;
  entityType: string;
  reasonCode: string;
  message: string | null;
  createdAt: string;
}

interface IntegrationStatusRow {
  integration_key: string;
  status: IntegrationCardConfig["status"];
  last_sync_at: string | null;
  last_sync_records: number | null;
  last_sync_error: string | null;
  endpoint_url: string | null;
  config: Record<string, unknown> | null;
}

interface HubSpotPortalRow {
  hub_id: string;
  is_active: boolean;
  updated_at: string;
}

interface HubSpotImportRunRow {
  id: string;
  initiated_by: string | null;
  status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
  started_at: string;
  completed_at: string | null;
  contacts_processed: number;
  companies_processed: number;
  deals_processed: number;
  activities_processed: number;
  error_count: number;
  error_summary: string | null;
}

interface HubSpotImportErrorRow {
  id: string;
  run_id: string;
  entity_type: string;
  reason_code: string;
  message: string | null;
  created_at: string;
}

interface OneDriveSyncStateRow {
  id: string;
  drive_id: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
}

interface TestConnectionResponse {
  success: boolean;
  latencyMs: number;
  mode: "live" | "mock";
  error?: { code: string; message: string };
}

const INTEGRATION_DISPLAY: Record<
  string,
  Pick<IntegrationCardConfig, "name" | "category" | "description" | "icon">
> = {
  hubspot: {
    name: "HubSpot QRM",
    category: "QRM Data Sync",
    description:
      "Manage HubSpot connection health and run bulk QRM imports with explicit confirmation.",
    icon: "HS",
  },
  sendgrid: {
    name: "SendGrid Email",
    category: "Communication Hub",
    description:
      "Outbound dealership email delivery for templates, follow-ups, and QRM timeline communication logs.",
    icon: "SG",
  },
  twilio: {
    name: "Twilio SMS",
    category: "Communication Hub",
    description:
      "Outbound SMS messaging for field-friendly customer follow-ups and timeline-linked communication history.",
    icon: "TW",
  },
  onedrive: {
    name: "Microsoft OneDrive",
    category: "Knowledge Base Sync",
    description:
      "Connect Microsoft 365 document libraries and sync dealership files into the knowledge base search index.",
    icon: "OD",
  },
  intellidealer: {
    name: "IntelliDealer (VitalEdge)",
    category: "Inventory & QRM",
    description:
      "Inventory, customer master data, and deal history from your dealer management system.",
    icon: "ID",
  },
  ironguides: {
    name: "Iron Solutions / IronGuides",
    category: "Equipment Valuations",
    description:
      "Fair market valuations and comparable sales data for used equipment pricing confidence.",
    icon: "IG",
  },
  rouse: {
    name: "Rouse Analytics",
    category: "Rental Rate & Utilization",
    description:
      "Regional rental benchmarks and fleet utilization signals to sharpen deal structuring.",
    icon: "RA",
  },
  aemp: {
    name: "AEMP 2.0 Telematics",
    category: "Fleet Intelligence",
    description:
      "Machine telemetry (hours, location, utilization) for replacement prediction and proactive outreach.",
    icon: "AT",
  },
  financing: {
    name: "Financing Partners",
    category: "Financing Rates",
    description:
      "Rate tables from AgDirect, CNH Capital, John Deere Financial, and AGCO Finance.",
    icon: "FP",
  },
  manufacturer_incentives: {
    name: "Manufacturer Incentives",
    category: "Incentive Programs",
    description:
      "Active OEM incentive and rebate programs from Barko, ASV, Bandit, Yanmar, and others.",
    icon: "MI",
  },
  auction_data: {
    name: "Auction Data",
    category: "Market Comps",
    description:
      "Historical auction results from Ritchie Bros., IronPlanet, and PurpleWave for comp-based pricing.",
    icon: "AD",
  },
  fred_usda: {
    name: "FRED / USDA Economic Data",
    category: "Economic Indicators",
    description:
      "Housing starts, construction spending, timber prices, and macro indicators from FRED and USDA.",
    icon: "FU",
  },
};

function buildHubSpotIntegrationRow(
  existingRow: IntegrationStatusRow | null,
  portalRows: HubSpotPortalRow[],
  latestRun: HubSpotImportRunRow | null
): IntegrationStatusRow {
  const hasActivePortal = portalRows.some((row) => row.is_active);

  let status: IntegrationCardConfig["status"];
  if (existingRow) {
    status = existingRow.status;
  } else if (hasActivePortal) {
    status = "connected";
  } else {
    status = "pending_credentials";
  }

  if (latestRun?.status === "failed" || latestRun?.status === "completed_with_errors") {
    status = "error";
  }

  const lastSyncError =
    latestRun?.status === "failed" || latestRun?.status === "completed_with_errors"
      ? latestRun.error_summary ?? "HubSpot import encountered an error."
      : existingRow?.last_sync_error ?? null;

  const syncRecords = latestRun
    ? latestRun.contacts_processed +
      latestRun.companies_processed +
      latestRun.deals_processed +
      latestRun.activities_processed
    : existingRow?.last_sync_records ?? null;

  return {
    integration_key: "hubspot",
    status,
    last_sync_at: latestRun?.completed_at ?? latestRun?.started_at ?? existingRow?.last_sync_at ?? null,
    last_sync_records: syncRecords,
    last_sync_error: lastSyncError,
    endpoint_url: existingRow?.endpoint_url ?? (hasActivePortal ? "https://app.hubspot.com" : null),
    config: existingRow?.config ?? {},
  };
}

async function resolveWorkspaceId(): Promise<string> {
  type RpcClient = {
    rpc: (
      fn: string,
      args?: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };

  const rpcClient = supabase as unknown as RpcClient;
  const { data, error } = await rpcClient.rpc("get_my_workspace");
  if (error || typeof data !== "string" || data.trim().length === 0) {
    return "default";
  }
  return data.trim();
}

function isSessionAuthError(err: PostgrestError | null): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  const code = String(err.code ?? "");
  if (code === "PGRST301") return true;
  if (msg.includes("jwt")) return true;
  if (msg.includes("invalid") && msg.includes("token")) return true;
  if (msg.includes("not authorized")) return true;
  return false;
}

function SummaryStrip({ cards }: { cards: IntegrationCardConfig[] }) {
  const connected = cards.filter((c) => c.status === "connected").length;
  const demo = cards.filter((c) => c.status === "demo_mode").length;
  const pendingSetup = cards.filter((c) => c.status === "pending_credentials").length;
  const errors = cards.filter((c) => c.status === "error").length;
  const lastSync = cards
    .filter((c) => c.lastSyncAt)
    .sort((a, b) => new Date(b.lastSyncAt!).getTime() - new Date(a.lastSyncAt!).getTime())[0]
    ?.lastSyncAt;

  return (
    <div className="flex items-center gap-6 flex-wrap text-sm">
      <div className="flex items-center gap-1.5 text-[#16A34A]">
        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
        <span className="font-semibold">{connected}</span>
        <span className="text-muted-foreground">Connected</span>
      </div>
      {demo > 0 && (
        <div className="flex items-center gap-1.5 text-[#C2410C]">
          <Wifi className="w-4 h-4" aria-hidden="true" />
          <span className="font-semibold">{demo}</span>
          <span className="text-muted-foreground">Demo</span>
        </div>
      )}
      {pendingSetup > 0 && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Settings className="w-4 h-4" aria-hidden="true" />
          <span className="font-semibold">{pendingSetup}</span>
          <span className="text-muted-foreground">Credentials needed</span>
        </div>
      )}
      {errors > 0 && (
        <div className="flex items-center gap-1.5 text-[#DC2626]">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          <span className="font-semibold">{errors}</span>
          <span className="text-muted-foreground">Attention needed</span>
        </div>
      )}
      {lastSync && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-4 h-4" aria-hidden="true" />
          <span className="text-muted-foreground">
            Last sync:{" "}
            <span className="font-medium text-[#374151]">
              {new Date(lastSync).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function CardSkeleton({ index }: { index: number }) {
  return (
    <div
      data-testid="integration-card-skeleton"
      data-skeleton-index={index}
      className="bg-card rounded-xl border border-border p-5 flex flex-col gap-4 animate-pulse"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-muted/40 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 bg-muted/40 rounded" />
          <div className="h-3 w-20 bg-muted/40 rounded" />
        </div>
      </div>
      <div className="h-3 w-24 bg-muted/40 rounded" />
      <div className="space-y-1.5">
        <div className="h-3 w-full bg-muted/40 rounded" />
        <div className="h-3 w-3/4 bg-muted/40 rounded" />
      </div>
      <div className="flex justify-between items-center pt-1 border-t border-[#F1F5F9]">
        <div className="h-3 w-20 bg-muted/40 rounded" />
        <div className="h-11 w-24 bg-muted/40 rounded" />
      </div>
    </div>
  );
}

export function IntegrationHub({ actorUserId, userRole }: IntegrationHubProps) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const [cards, setCards] = useState<IntegrationCardConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [hubSpotImportRuns, setHubSpotImportRuns] = useState<HubSpotImportRunSummary[]>([]);
  const [hubSpotImportErrors, setHubSpotImportErrors] = useState<HubSpotImportErrorSummary[]>([]);
  const hubspotStatus = searchParams.get("hubspot");
  const hubspotMessage = searchParams.get("message");
  const onedriveStatus = searchParams.get("onedrive");
  const onedriveMessage = searchParams.get("message");

  const loadIntegrations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { error: userError } = await supabase.auth.getUser();
      if (userError) {
        await supabase.auth.signOut();
        return;
      }

      const baseFetchPromise = Promise.all([
        resolveWorkspaceId(),
        supabase
          .from("integration_status")
          .select("integration_key, status, last_sync_at, last_sync_records, last_sync_error, endpoint_url, config")
          .order("integration_key"),
      ]);

      const [workspaceResult, integrationStatusResult] =
        await Promise.race([
          baseFetchPromise,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Request timed out. Please try again.")), 5000);
          }),
        ]);

      const workspaceId = workspaceResult;
      if (!workspaceId) {
        throw new Error("Workspace context was empty.");
      }

      if (integrationStatusResult.error) {
        if (isSessionAuthError(integrationStatusResult.error)) {
          await supabase.auth.signOut();
          return;
        }
        throw integrationStatusResult.error;
      }

      const hubspotFetchPromise = Promise.all([
        hubspotAdminSupabase
          .from("workspace_hubspot_portal")
          .select("hub_id, is_active, updated_at")
          .eq("workspace_id", workspaceId)
          .eq("is_active", true)
          .limit(1),
        hubspotAdminSupabase
          .from("crm_hubspot_import_runs")
          .select(
            "id, initiated_by, status, started_at, completed_at, contacts_processed, companies_processed, deals_processed, activities_processed, error_count, error_summary"
          )
          .eq("workspace_id", workspaceId)
          .order("started_at", { ascending: false })
          .limit(8),
        hubspotAdminSupabase
          .from("crm_hubspot_import_errors")
          .select("id, run_id, entity_type, reason_code, message, created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(250),
        supabase
          .from("onedrive_sync_state")
          .select("id, drive_id, access_token, token_expires_at, last_synced_at")
          .eq("user_id", actorUserId)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("source", "onedrive"),
      ]);

      const [
        hubspotPortalResult,
        hubspotImportRunsResult,
        hubspotImportErrorsResult,
        oneDriveSyncStateResult,
        oneDriveDocumentsResult,
      ] = await Promise.race([
        hubspotFetchPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("HubSpot status request timed out. Please try again.")), 5000);
        }),
      ]);

      const integrationRows = (integrationStatusResult.data ?? []) as IntegrationStatusRow[];
      const rowByKey = new Map(integrationRows.map((row) => [row.integration_key, row]));

      const portalRows = (hubspotPortalResult.data ?? []) as HubSpotPortalRow[];
      const hubspotImportRuns = (hubspotImportRunsResult.data ?? []) as HubSpotImportRunRow[];
      const latestImportRun = hubspotImportRuns[0] ?? null;

      rowByKey.set(
        "hubspot",
        buildHubSpotIntegrationRow(rowByKey.get("hubspot") ?? null, portalRows, latestImportRun)
      );

      const oneDriveState = (oneDriveSyncStateResult.data ?? null) as OneDriveSyncStateRow | null;
      const oneDriveDocumentCount = oneDriveDocumentsResult.count ?? 0;
      const oneDriveExpired =
        typeof oneDriveState?.token_expires_at === "string" &&
        Date.parse(oneDriveState.token_expires_at) < Date.now();

      rowByKey.set("onedrive", {
        integration_key: "onedrive",
        status: !oneDriveState || !oneDriveState.access_token
          ? "pending_credentials"
          : oneDriveExpired
          ? "error"
          : "connected",
        last_sync_at: oneDriveState?.last_synced_at ?? null,
        last_sync_records: oneDriveDocumentCount,
        last_sync_error: oneDriveExpired
          ? "OneDrive authorization expired. Reconnect Microsoft 365 before the next sync."
          : null,
        endpoint_url: "https://graph.microsoft.com/v1.0",
        config: {
          sync_state_id: oneDriveState?.id ?? null,
          drive_id: oneDriveState?.drive_id ?? null,
          token_expires_at: oneDriveState?.token_expires_at ?? null,
        },
      });

      const mapped: IntegrationCardConfig[] = Object.keys(INTEGRATION_DISPLAY).map((key) => {
        const row = rowByKey.get(key) ?? {
          integration_key: key,
          status: "pending_credentials" as const,
          last_sync_at: null,
          last_sync_records: null,
          last_sync_error: null,
          endpoint_url: null,
          config: {},
        };

        return {
          key: row.integration_key,
          status: row.status,
          lastSyncAt: row.last_sync_at,
          syncRecords: row.last_sync_records,
          lastSyncError: row.last_sync_error,
          endpointUrl: row.endpoint_url,
          config: row.config ?? {},
          ...INTEGRATION_DISPLAY[key],
        };
      });

      setCards(mapped);
      setHubSpotImportRuns(
        hubspotImportRuns.map((row): HubSpotImportRunSummary => ({
          id: row.id,
          initiatedBy: row.initiated_by,
          status: row.status,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          contactsProcessed: row.contacts_processed,
          companiesProcessed: row.companies_processed,
          dealsProcessed: row.deals_processed,
          activitiesProcessed: row.activities_processed,
          errorCount: row.error_count,
          errorSummary: row.error_summary,
        })),
      );
      setHubSpotImportErrors(
        ((hubspotImportErrorsResult.data ?? []) as HubSpotImportErrorRow[]).map((row) => ({
          id: row.id,
          runId: row.run_id,
          entityType: row.entity_type,
          reasonCode: row.reason_code,
          message: row.message,
          createdAt: row.created_at,
        })),
      );
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred. Refresh the page to try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setCards([]);
    setHubSpotImportRuns([]);
    setHubSpotImportErrors([]);
    void loadIntegrations();
  }, [location.key, loadIntegrations]);

  useEffect(() => {
    void trackIntegrationEvent("admin_integrations_viewed", {
      route: "/admin/integrations",
      role: userRole,
    });
  }, [userRole]);

  function handleConfigure(key: string) {
    setSelectedKey(key);
    setPanelOpen(true);
    void trackIntegrationEvent("integration_panel_opened", {
      integration_key: key,
      source: "grid",
    });
  }

  async function handleTestSync(key: string) {
    void trackIntegrationEvent("integration_test_connection_clicked", {
      integration_key: key,
      trigger: "card_test_connection",
    });

    const { data, error: invokeError } = await supabase.functions.invoke<TestConnectionResponse>(
      "integration-test-connection",
      {
        body: { integration_key: key },
      }
    );

    if (invokeError) {
      throw new Error(invokeError.message || "Connection test failed.");
    }

    if (data && !data.success) {
      setSelectedKey(key);
      setPanelOpen(true);
    }

    await loadIntegrations();
  }

  const selectedCard = cards.find((c) => c.key === selectedKey) ?? null;

  if (error) {
    return (
      <div className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 flex items-center justify-center py-24">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-10 h-10 text-[#DC2626] mx-auto mb-3" aria-hidden="true" />
          <h3 className="text-base font-semibold text-foreground mb-1">Failed to load integrations</h3>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              void loadIntegrations();
            }}
            className="mt-4 text-sm text-[#C2410C] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 flex flex-col gap-6 overflow-x-hidden">
      <div className="space-y-3">
        <div>
          <h1 className="text-[28px] font-bold text-foreground leading-8">Integrations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect external data sources to power the Deal Genome Engine.
          </p>
        </div>
        {(hubspotStatus || onedriveStatus) && (
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-sm",
              (hubspotStatus === "connected" || onedriveStatus === "connected")
                ? "border-emerald-400/40 bg-emerald-500/10 text-green-700 dark:text-green-400"
                : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]",
            )}
          >
            {hubspotStatus
              ? hubspotStatus === "connected"
                ? "HubSpot connected successfully. Refresh the panel if the portal status lags behind the OAuth handoff."
                : hubspotMessage ?? "HubSpot connection did not complete."
              : onedriveStatus === "connected"
              ? "OneDrive connected successfully. Run a sync to refresh dealership documents in the knowledge base."
              : onedriveMessage ?? "OneDrive connection did not complete."}
          </div>
        )}
        {!loading && cards.length > 0 && <SummaryStrip cards={cards} />}
      </div>

      <div
        className={cn(
          "grid gap-6",
          "grid-cols-1",
          "md:grid-cols-2",
          "lg:grid-cols-3",
          "[@media(min-width:1440px)]:grid-cols-4"
        )}
        aria-label="Integration cards"
        aria-busy={loading}
        data-loading={loading}
      >
        {loading
          ? Array.from({ length: Object.keys(INTEGRATION_DISPLAY).length }).map((_, i) => (
              <CardSkeleton key={i} index={i} />
            ))
          : cards.map((card) => (
              <IntegrationCard
                key={card.key}
                config={card}
                onConfigure={handleConfigure}
                onTestSync={handleTestSync}
              />
            ))}
      </div>

      {!loading && cards.length === 0 && (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-sm">
            <Wifi className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" aria-hidden="true" />
            <h3 className="text-base font-semibold text-foreground mb-1">No integrations found</h3>
            <p className="text-sm text-muted-foreground">
              Your integrations aren't set up yet. Contact your administrator or {BRAND_NAME} support to complete
              initial setup.
            </p>
          </div>
        </div>
      )}

      <IntegrationPanel
        integration={selectedCard}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSaved={loadIntegrations}
        actorUserId={actorUserId}
        hubSpotImportRuns={hubSpotImportRuns}
        hubSpotImportErrors={hubSpotImportErrors}
      />
    </div>
  );
}
