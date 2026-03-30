/**
 * IntegrationPanel — right-side drawer (desktop) / full-screen sheet (mobile).
 * Contains: connection status, credential form, sync scope toggles, audit log.
 * Per blueprint §6.2 and CDO design direction §1 (Drawer pattern).
 */

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, Clock, Database } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DataSourceBadge, type DataSourceState } from "./DataSourceBadge";
import { cn } from "@/lib/utils";
import type {
  HubSpotImportErrorSummary,
  HubSpotImportRunSummary,
  IntegrationCardConfig,
} from "./IntegrationHub";
import { supabase } from "@/lib/supabase";
import { trackIntegrationEvent } from "@/lib/track-event";
import { useToast } from "@/hooks/use-toast";

// Per-integration sync scope definitions
const SYNC_SCOPES: Record<string, { key: string; label: string; description: string }[]> = {
  hubspot: [
    { key: "companies", label: "Companies", description: "Account records from HubSpot CRM" },
    { key: "contacts", label: "Contacts", description: "People and role details linked to accounts" },
    { key: "deals", label: "Deals", description: "Pipeline opportunities and stage transitions" },
    { key: "activities", label: "Activities", description: "Calls, notes, and timeline events" },
  ],
  intellidealer: [
    { key: "inventory", label: "Inventory", description: "Machine listings and stock levels" },
    { key: "customers", label: "Customers", description: "Customer master records and contacts" },
    { key: "deals", label: "Deal History", description: "Closed and open deal records" },
  ],
  ironguides: [
    { key: "valuations", label: "Valuations", description: "FMV and retail value estimates" },
    { key: "comparables", label: "Comparables", description: "Recent comparable sales" },
  ],
  rouse: [
    { key: "rental_rates", label: "Rental Rates", description: "Regional benchmark rates" },
    { key: "utilization", label: "Utilization", description: "Fleet utilization metrics" },
  ],
  aemp: [
    { key: "telemetry", label: "Telemetry", description: "Machine hours and location" },
    { key: "fault_codes", label: "Fault Codes", description: "Active diagnostic codes" },
  ],
  financing: [
    { key: "rate_tables", label: "Rate Tables", description: "Current rates by lender" },
    { key: "programs", label: "Programs", description: "Active promotional programs" },
  ],
  manufacturer_incentives: [
    { key: "incentives", label: "Incentives", description: "OEM rebates and offers" },
    { key: "programs", label: "Programs", description: "Volume and loyalty programs" },
  ],
  auction_data: [
    { key: "results", label: "Auction Results", description: "Historical hammer prices" },
    { key: "upcoming", label: "Upcoming Auctions", description: "Scheduled auction events" },
  ],
  fred_usda: [
    { key: "economic", label: "Economic Indicators", description: "FRED macro data series" },
    { key: "agricultural", label: "Agricultural Data", description: "USDA commodity data" },
  ],
};

interface IntegrationPanelProps {
  integration: IntegrationCardConfig | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  actorUserId: string;
  hubSpotImportRuns: HubSpotImportRunSummary[];
  hubSpotImportErrors: HubSpotImportErrorSummary[];
}

interface TestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
}

interface TestConnectionResponse {
  success: boolean;
  latencyMs: number;
  mode: "live" | "mock";
  error?: { code: string; message: string };
}

interface HubSpotImportResult {
  runId: string;
  status: "completed" | "completed_with_errors" | "failed" | "running" | "queued" | "cancelled";
  counts: {
    companies: number;
    contacts: number;
    deals: number;
    activities: number;
    errors: number;
  };
}

function statusToDataSource(status: IntegrationCardConfig["status"]): DataSourceState {
  switch (status) {
    case "connected": return "Live";
    case "demo_mode": return "Demo";
    case "pending_credentials": return "Manual";
    case "error": return "Error";
    default: return "Manual";
  }
}

const HUBSPOT_RESUMABLE_STATUSES = new Set<
  HubSpotImportRunSummary["status"]
>(["failed", "cancelled"]);

function hubspotRunStatusLabel(
  status: HubSpotImportRunSummary["status"],
): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "completed_with_errors":
      return "Completed with errors";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

function hubspotRunStatusTone(
  status: HubSpotImportRunSummary["status"],
): string {
  switch (status) {
    case "completed":
      return "text-[#166534]";
    case "completed_with_errors":
      return "text-[#9A3412]";
    case "failed":
      return "text-[#B91C1C]";
    case "running":
      return "text-[#1D4ED8]";
    default:
      return "text-[#374151]";
  }
}

function formatHubSpotRunTimestamp(value: string | null): string {
  if (!value) return "In progress";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHubSpotRunCount(run: HubSpotImportRunSummary): string {
  const total = run.companiesProcessed +
    run.contactsProcessed +
    run.dealsProcessed +
    run.activitiesProcessed;
  return `${total.toLocaleString()} records`;
}

export function IntegrationPanel({
  integration,
  open,
  onClose,
  onSaved,
  actorUserId,
  hubSpotImportRuns,
  hubSpotImportErrors,
}: IntegrationPanelProps) {
  const { toast } = useToast();
  const scopes = SYNC_SCOPES[integration?.key ?? ""] ?? [];
  const defaultScopes = Object.fromEntries(scopes.map((s) => [s.key, true]));

  const [credentials, setCredentials] = useState("");
  const [hubspotClientId, setHubspotClientId] = useState("");
  const [hubspotClientSecret, setHubspotClientSecret] = useState("");
  const [hubspotAppId, setHubspotAppId] = useState("");
  const [endpointUrl, setEndpointUrl] = useState(integration?.endpointUrl ?? "");
  const [syncScopes, setSyncScopes] = useState<Record<string, boolean>>(defaultScopes);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearingCredentials, setIsClearingCredentials] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hubSpotImportDialogOpen, setHubSpotImportDialogOpen] = useState(false);
  const [isRunningHubSpotImport, setIsRunningHubSpotImport] = useState(false);
  const [hubSpotImportResult, setHubSpotImportResult] = useState<HubSpotImportResult | null>(null);
  const [hubSpotImportError, setHubSpotImportError] = useState<string | null>(null);
  const [selectedResumeRunId, setSelectedResumeRunId] = useState<string | null>(null);

  // Reset all panel state when the selected integration changes
  useEffect(() => {
    if (!integration) return;
    const currentScopes = SYNC_SCOPES[integration.key] ?? [];
    setCredentials("");
    setHubspotClientId("");
    setHubspotClientSecret("");
    setHubspotAppId("");
    setEndpointUrl(integration.endpointUrl ?? "");
    setSyncScopes(Object.fromEntries(currentScopes.map((s) => [s.key, true])));
    setTestResult(null);
    setSaveError(null);
    setHubSpotImportDialogOpen(false);
    setIsRunningHubSpotImport(false);
    setHubSpotImportResult(null);
    setHubSpotImportError(null);
    setSelectedResumeRunId(null);
  }, [integration?.key]);

  const isHubSpot = integration?.key === "hubspot";
  const resumableHubSpotRuns = hubSpotImportRuns.filter((run) =>
    HUBSPOT_RESUMABLE_STATUSES.has(run.status) && run.initiatedBy === actorUserId
  );

  useEffect(() => {
    if (!isHubSpot) {
      setSelectedResumeRunId(null);
      return;
    }
    const resumableRuns = hubSpotImportRuns.filter((run) =>
      HUBSPOT_RESUMABLE_STATUSES.has(run.status) && run.initiatedBy === actorUserId
    );
    setSelectedResumeRunId((current) =>
      current && resumableRuns.some((run) => run.id === current)
        ? current
        : (resumableRuns[0]?.id ?? null)
    );
  }, [isHubSpot, actorUserId, hubSpotImportRuns]);

  if (!integration) return null;
  const activeReconciliationRunId = hubSpotImportResult?.runId ??
    selectedResumeRunId ??
    hubSpotImportRuns[0]?.id ??
    null;
  const activeRunErrors = activeReconciliationRunId
    ? hubSpotImportErrors.filter((error) => error.runId === activeReconciliationRunId)
    : [];

  const errorCountByEntity = activeRunErrors.reduce<Record<string, number>>((acc, error) => {
    acc[error.entityType] = (acc[error.entityType] ?? 0) + 1;
    return acc;
  }, {});
  const topEntityErrorRows = Object.entries(errorCountByEntity)
    .map(([entityType, count]) => ({ entityType, count }))
    .sort((a, b) => b.count - a.count);

  async function handleSave() {
    if (!integration) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      let credentialsPayload = credentials;
      if (isHubSpot) {
        if (
          !hubspotClientId.trim() || !hubspotClientSecret.trim() ||
          !hubspotAppId.trim()
        ) {
          throw new Error(
            "HubSpot client ID, client secret, and app ID are required.",
          );
        }
        credentialsPayload = JSON.stringify({
          client_id: hubspotClientId.trim(),
          client_secret: hubspotClientSecret.trim(),
          app_id: hubspotAppId.trim(),
        });
      }

      const { error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "update_integration",
          integration_key: integration.key,
          credentials: credentialsPayload,
          endpoint_url: endpointUrl || null,
          sync_scopes: syncScopes,
        },
      });
      if (error) throw new Error(error.message);
      const statusAfter = (isHubSpot || credentials.trim().length > 0)
        ? "pending_credentials"
        : "unchanged";
      void trackIntegrationEvent("integration_credentials_saved", {
        integration_key: integration.key,
        auth_type: isHubSpot ? "oauth_app" : credentials.trim() ? "token" : "existing",
        status_after: statusAfter,
      });
      toast({
        title: "Credentials saved",
        description: `${integration.name} configuration updated.`,
      });
      setCredentials("");
      setHubspotClientId("");
      setHubspotClientSecret("");
      setHubspotAppId("");
      onSaved();
      onClose();
    } catch (err) {
      console.error("Save credentials error:", err);
      void trackIntegrationEvent("integration_credentials_save_failed", {
        integration_key: integration.key,
        error_code: "save_failed",
      });
      setSaveError("Could not save your credentials. Check your connection and try again.");
      toast({
        title: "Save failed",
        description: "Could not save credentials. Check values and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClearCredentials() {
    if (!integration) return;

    const confirmed = window.confirm(
      `Clear stored credentials for ${integration.name}? This cannot be undone.`,
    );
    if (!confirmed) return;

    setIsClearingCredentials(true);
    setSaveError(null);
    try {
      const { error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "update_integration",
          integration_key: integration.key,
          clear_credentials: true,
        },
      });
      if (error) throw new Error(error.message);

      void trackIntegrationEvent("integration_credentials_saved", {
        integration_key: integration.key,
        auth_type: "cleared",
        status_after: "pending_credentials",
      });

      setCredentials("");
      setHubspotClientId("");
      setHubspotClientSecret("");
      setHubspotAppId("");
      setTestResult(null);

      toast({
        title: "Credentials cleared",
        description: `${integration.name} is back in pending setup mode.`,
      });
      await onSaved();
      onClose();
    } catch (err) {
      console.error("Clear credentials error:", err);
      void trackIntegrationEvent("integration_credentials_save_failed", {
        integration_key: integration.key,
        error_code: "clear_failed",
      });
      setSaveError("Could not clear credentials. Try again.");
      toast({
        title: "Clear failed",
        description: "Could not clear credentials. Try again.",
        variant: "destructive",
      });
    } finally {
      setIsClearingCredentials(false);
    }
  }

  async function handleTest() {
    if (!integration) return;
    setIsTesting(true);
    setTestResult(null);

    void trackIntegrationEvent("integration_test_connection_clicked", {
      integration_key: integration.key,
      trigger: "panel_test_connection",
    });

    try {
      const { data, error } = await supabase.functions.invoke<TestConnectionResponse>(
        "integration-test-connection",
        {
          body: {
            integration_key: integration.key,
          },
        }
      );

      if (error) throw new Error(error.message);

      const result: TestResult = {
        success: Boolean(data?.success),
        latencyMs: data?.latencyMs ?? 0,
        error: data?.error?.message,
      };
      setTestResult(result);
      if (result.success) {
        toast({
          title: "Connection successful",
          description: `${integration.name} responded in ${result.latencyMs}ms.`,
        });
      } else {
        toast({
          title: "Connection failed",
          description: result.error ?? "Review credentials and endpoint settings.",
          variant: "destructive",
        });
      }
      await onSaved();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Test failed";
      setTestResult({ success: false, latencyMs: 0, error: errMsg });
      toast({
        title: "Connection test failed",
        description: errMsg,
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function runHubSpotImport(runId?: string): Promise<void> {
    setHubSpotImportError(null);
    setHubSpotImportResult(null);
    setIsRunningHubSpotImport(true);
    setHubSpotImportDialogOpen(false);
    try {
      const { data, error } = await supabase.functions.invoke("crm-hubspot-import", {
        body: runId ? { runId } : {},
      });
      if (error) {
        throw new Error(error.message || "HubSpot import failed to start.");
      }

      const result = data as HubSpotImportResult;
      if (!result || typeof result !== "object" || !result.runId || !result.counts) {
        throw new Error("HubSpot import returned an invalid response.");
      }

      setHubSpotImportResult(result);
      if (result.status === "completed_with_errors" || result.status === "failed") {
        setHubSpotImportError(
          result.status === "failed"
            ? "HubSpot import failed. Review CRM import logs and retry."
            : "HubSpot import completed with errors. Review CRM import logs for failed rows."
        );
      }
      toast({
        title: runId ? "HubSpot import resumed" : "HubSpot import finished",
        description:
          result.status === "completed"
            ? "Import completed successfully."
            : "Import finished with warnings. Review run details below.",
      });
      onSaved();
    } catch (err) {
      setHubSpotImportError(
        err instanceof Error
          ? err.message
          : "HubSpot import failed. Check your connection and try again."
      );
    } finally {
      setIsRunningHubSpotImport(false);
    }
  }

  const dataSourceState = statusToDataSource(integration.status);

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full lg:max-w-[460px] [@media(min-width:1440px)]:max-w-[520px] flex flex-col p-0 gap-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center text-lg font-bold text-foreground shrink-0">
              {integration.icon}
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-[15px] font-semibold text-foreground leading-5">
                {integration.name}
              </SheetTitle>
              <SheetDescription className="text-xs text-[#64748B] mt-0.5">
                {integration.category}
              </SheetDescription>
            </div>
            <DataSourceBadge state={dataSourceState} />
          </div>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Section 1: Connection status */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-3">Connection status</h4>
            <div
              className={cn(
                "rounded-lg border p-4 flex items-start gap-3",
                integration.status === "connected"
                  ? "bg-[#F0FDF4] border-[#BBF7D0]"
                  : integration.status === "error"
                  ? "bg-[#FEF2F2] border-[#FECACA]"
                  : "bg-muted border-border"
              )}
            >
              {integration.status === "connected" ? (
                <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" aria-hidden="true" />
              ) : integration.status === "error" ? (
                <XCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {integration.status === "connected"
                    ? "Connected"
                    : integration.status === "error"
                    ? "Connection error"
                    : integration.status === "demo_mode"
                    ? "Running in demo mode"
                    : "Credentials needed"}
                </p>
                {integration.lastSyncError && (
                  <p className="text-xs text-[#DC2626] mt-1 break-words">{integration.lastSyncError}</p>
                )}
                {integration.status === "pending_credentials" && (
                  <p className="text-xs text-[#64748B] mt-1">
                    Add your credentials below to connect. It'll run in demo mode until you do.
                  </p>
                )}
              </div>
            </div>
          </section>

          {isHubSpot && (
            <>
              <Separator className="bg-[#F1F5F9]" />

              <section>
                <h4 className="text-sm font-semibold text-foreground mb-1">Bulk import</h4>
                <p className="text-xs text-[#64748B] mb-3">
                  Import HubSpot companies, contacts, deals, and activities into CRM.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border text-foreground hover:bg-muted focus-visible:ring-qep-orange w-full"
                  onClick={() => setHubSpotImportDialogOpen(true)}
                  disabled={isRunningHubSpotImport}
                >
                  {isRunningHubSpotImport ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />
                      Running import…
                    </>
                  ) : (
                    "Run new HubSpot import"
                  )}
                </Button>

                {resumableHubSpotRuns.length > 0 && (
                  <div className="mt-3 rounded-lg border border-[#FED7AA] bg-[#FFF7ED] p-3">
                    <p className="text-xs font-medium text-[#9A3412]">
                      Resume a failed/cancelled run from your account
                    </p>
                    <div className="mt-2 space-y-2">
                      {resumableHubSpotRuns.slice(0, 3).map((run) => (
                        <Button
                          key={run.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-auto min-h-[44px] w-full justify-start px-3 py-2 text-left",
                            selectedResumeRunId === run.id
                              ? "border-qep-orange ring-1 ring-qep-orange"
                              : "border-[#FED7AA] bg-white",
                          )}
                          onClick={() => setSelectedResumeRunId(run.id)}
                        >
                          <span className="block w-full">
                            <span className="flex items-center justify-between gap-2">
                              <span className={cn("text-xs font-semibold", hubspotRunStatusTone(run.status))}>
                                {hubspotRunStatusLabel(run.status)}
                              </span>
                              <span className="text-[10px] text-[#64748B]">
                                {formatHubSpotRunTimestamp(run.startedAt)}
                              </span>
                            </span>
                            <span className="mt-1 block text-[11px] text-[#64748B]">
                              {formatHubSpotRunCount(run)}
                              {run.errorCount > 0
                                ? ` • ${run.errorCount.toLocaleString()} errors`
                                : ""}
                            </span>
                          </span>
                        </Button>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full border-[#FED7AA] text-[#9A3412] hover:bg-[#FFEDD5] focus-visible:ring-qep-orange"
                      onClick={() => void runHubSpotImport(selectedResumeRunId ?? undefined)}
                      disabled={isRunningHubSpotImport || !selectedResumeRunId}
                    >
                      {isRunningHubSpotImport ? "Running import…" : "Resume selected import"}
                    </Button>
                  </div>
                )}

                <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-foreground">Recent import runs</p>
                  {hubSpotImportRuns.length === 0 ? (
                    <p className="mt-1 text-xs text-[#64748B]">
                      No prior runs in this workspace.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {hubSpotImportRuns.slice(0, 5).map((run) => (
                        <div
                          key={run.id}
                          className="rounded border border-border bg-card px-2.5 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn("font-semibold", hubspotRunStatusTone(run.status))}>
                              {hubspotRunStatusLabel(run.status)}
                            </span>
                            <span className="text-[#64748B]">
                              {formatHubSpotRunTimestamp(run.completedAt ?? run.startedAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-[#64748B]">
                            {formatHubSpotRunCount(run)}
                            {run.errorCount > 0
                              ? ` • ${run.errorCount.toLocaleString()} errors`
                              : ""}
                          </p>
                          {run.errorSummary && (
                            <p className="mt-1 text-[#B91C1C] line-clamp-2">{run.errorSummary}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-3 rounded-lg border border-border bg-card p-3">
                  <p className="text-xs font-medium text-foreground">Reconciliation details</p>
                  {!activeReconciliationRunId ? (
                    <p className="mt-1 text-xs text-[#64748B]">
                      Run an import to generate reconciliation data.
                    </p>
                  ) : activeRunErrors.length === 0 ? (
                    <p className="mt-1 text-xs text-[#166534]">
                      No error rows found for run {activeReconciliationRunId.slice(0, 8)}.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <p className="text-[11px] text-[#64748B]">
                        Run {activeReconciliationRunId.slice(0, 8)} has{" "}
                        {activeRunErrors.length.toLocaleString()} error rows.
                      </p>
                      <div className="space-y-1">
                        {topEntityErrorRows.slice(0, 4).map((row) => (
                          <div
                            key={row.entityType}
                            className="flex items-center justify-between rounded border border-border px-2 py-1 text-[11px]"
                          >
                            <span className="font-medium text-foreground">{row.entityType}</span>
                            <span className="text-[#B91C1C]">{row.count.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                      {activeRunErrors.slice(0, 2).map((error) => (
                        <p key={error.id} className="text-[11px] text-[#B91C1C] line-clamp-2">
                          {error.reasonCode}: {error.message ?? "No message provided."}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {hubSpotImportError && (
                  <p className="text-xs text-[#DC2626] mt-2">{hubSpotImportError}</p>
                )}

                {hubSpotImportResult && (
                  <div
                    className={cn(
                      "mt-3 rounded-lg border p-3 text-xs",
                      hubSpotImportResult.status === "completed"
                        ? "bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]"
                        : "bg-[#FFF7ED] border-[#FED7AA] text-[#9A3412]"
                    )}
                    role="status"
                    aria-live="polite"
                  >
                    <p className="font-semibold">
                      Import {hubSpotImportResult.status === "completed" ? "completed" : "finished"}
                    </p>
                    <p className="mt-1">
                      {hubSpotImportResult.counts.companies.toLocaleString()} companies,{" "}
                      {hubSpotImportResult.counts.contacts.toLocaleString()} contacts,{" "}
                      {hubSpotImportResult.counts.deals.toLocaleString()} deals,{" "}
                      {hubSpotImportResult.counts.activities.toLocaleString()} activities
                    </p>
                    {hubSpotImportResult.counts.errors > 0 && (
                      <p className="mt-1">
                        {hubSpotImportResult.counts.errors.toLocaleString()} records need attention.
                      </p>
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          <Separator className="bg-[#F1F5F9]" />

          {/* Section 2: Credential form */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-3">Credentials &amp; configuration</h4>
            <div className="space-y-4">
              {isHubSpot ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="hubspot-client-id" className="text-xs font-medium text-[#374151]">
                      HubSpot Client ID
                      <span className="text-[#64748B] ml-1">(required)</span>
                    </Label>
                    <Input
                      id="hubspot-client-id"
                      type="text"
                      placeholder="Enter HubSpot client ID"
                      value={hubspotClientId}
                      onChange={(e) => setHubspotClientId(e.target.value)}
                      className="font-mono text-sm focus-visible:ring-qep-orange"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hubspot-client-secret" className="text-xs font-medium text-[#374151]">
                      HubSpot Client Secret
                      <span className="text-[#64748B] ml-1">(required)</span>
                    </Label>
                    <Input
                      id="hubspot-client-secret"
                      type="password"
                      placeholder="Enter HubSpot client secret"
                      value={hubspotClientSecret}
                      onChange={(e) => setHubspotClientSecret(e.target.value)}
                      className="font-mono text-sm focus-visible:ring-qep-orange"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hubspot-app-id" className="text-xs font-medium text-[#374151]">
                      HubSpot App ID
                      <span className="text-[#64748B] ml-1">(required)</span>
                    </Label>
                    <Input
                      id="hubspot-app-id"
                      type="text"
                      placeholder="Enter HubSpot app ID"
                      value={hubspotAppId}
                      onChange={(e) => setHubspotAppId(e.target.value)}
                      className="font-mono text-sm focus-visible:ring-qep-orange"
                      autoComplete="off"
                    />
                  </div>
                  <p className="text-xs text-[#64748B]">
                    Stored with AES-256-GCM encryption. Values are only used server-side for OAuth,
                    webhook verification, and token refresh.
                  </p>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="credentials" className="text-xs font-medium text-[#374151]">
                    API Key / Token
                    <span className="text-[#64748B] ml-1">(encrypted at rest)</span>
                  </Label>
                  <Input
                    id="credentials"
                    type="password"
                    placeholder={
                      integration.status === "connected"
                        ? "Leave blank to keep current credentials"
                        : "Enter API key or bearer token"
                    }
                    value={credentials}
                    onChange={(e) => setCredentials(e.target.value)}
                    className="font-mono text-sm focus-visible:ring-qep-orange"
                    autoComplete="off"
                  />
                  <p className="text-xs text-[#64748B]">
                    Stored with AES-256-GCM encryption. Never logged or exposed in plaintext.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="endpoint-url" className="text-xs font-medium text-[#374151]">
                  Endpoint URL
                  <span className="text-[#64748B] ml-1">(optional)</span>
                </Label>
                <Input
                  id="endpoint-url"
                  type="url"
                  placeholder="https://api.vendor.com"
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  className="text-sm focus-visible:ring-qep-orange"
                />
              </div>
            </div>
            {saveError && (
              <p className="text-xs text-[#DC2626] mt-2">{saveError}</p>
            )}
          </section>

          <Separator className="bg-[#F1F5F9]" />

          {/* Section 3: Connection test */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-3">Connection test</h4>
            <Button
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-muted focus-visible:ring-qep-orange w-full"
              onClick={() => void handleTest()}
              disabled={isTesting}
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />
                  Testing connection…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                  Test connection
                </>
              )}
            </Button>
            {testResult !== null && (
              <div
                className={cn(
                  "mt-3 rounded-lg border p-3 flex items-start gap-2",
                  testResult.success
                    ? "bg-[#F0FDF4] border-[#BBF7D0]"
                    : "bg-[#FEF2F2] border-[#FECACA]"
                )}
                role="status"
                aria-live="polite"
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <XCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {testResult.success
                      ? "Connection successful"
                      : "Connection failed — check your credentials and endpoint URL, then try again."}
                  </p>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    {testResult.success
                      ? `Response in ${testResult.latencyMs}ms`
                      : testResult.error}
                  </p>
                </div>
              </div>
            )}
          </section>

          <Separator className="bg-[#F1F5F9]" />

          {/* Section 4: Sync scope toggles */}
          {scopes.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold text-foreground mb-1">Sync scope</h4>
              <p className="text-xs text-[#64748B] mb-3">
                Choose which data types to sync from this integration.
              </p>
              <div className="space-y-3">
                {scopes.map((scope) => (
                  <div key={scope.key} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground leading-none">{scope.label}</p>
                      <p className="text-xs text-[#64748B] mt-0.5">{scope.description}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={syncScopes[scope.key] ?? true}
                      aria-label={`Toggle ${scope.label} sync`}
                      onClick={() =>
                        setSyncScopes((prev) => ({ ...prev, [scope.key]: !(prev[scope.key] ?? true) }))
                      }
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
                        (syncScopes[scope.key] ?? true) ? "bg-qep-orange" : "bg-muted"
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none block h-4 w-4 rounded-full bg-card shadow-sm transition-transform duration-200 mt-0.5",
                          (syncScopes[scope.key] ?? true) ? "translate-x-[18px]" : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <Separator className="bg-[#F1F5F9]" />

          {/* Section 5: Audit / activity log */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-3">Recent activity</h4>
            {integration.lastSyncAt ? (
              <div className="space-y-2">
                <div
                  className={cn(
                    "rounded-lg border p-3 flex items-start gap-2.5",
                    integration.lastSyncError
                      ? "bg-[#FEF2F2] border-[#FECACA]"
                      : "bg-[#F0FDF4] border-[#BBF7D0]"
                  )}
                >
                  {integration.lastSyncError ? (
                    <XCircle className="w-3.5 h-3.5 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">
                        {integration.lastSyncError ? "Sync failed" : "Sync completed"}
                      </p>
                      <span className="text-[10px] text-[#64748B] shrink-0">
                        {new Date(integration.lastSyncAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {integration.lastSyncError ? (
                      <p className="text-xs text-[#DC2626] mt-0.5 break-words">{integration.lastSyncError}</p>
                    ) : integration.syncRecords !== null ? (
                      <p className="text-xs text-[#64748B] mt-0.5">
                        <Database className="w-3 h-3 inline mr-1 -mt-px" aria-hidden="true" />
                        {integration.syncRecords.toLocaleString()} records synced
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[#64748B]">
                <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                <p className="text-xs">No sync history — first sync will run after connecting.</p>
              </div>
            )}
          </section>

          <Separator className="bg-[#F1F5F9]" />

          {/* Section 6: Fallback / demo mode explanation */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-2">Demo mode</h4>
            <p className="text-sm text-[#64748B] leading-relaxed">
              While disconnected, we use realistic sample data that mirrors what{" "}
              <strong className="text-foreground">{integration.name}</strong> would provide.
              All Deal Genome Engine features remain fully operational. Data source badges
              will show <span className="font-medium text-qep-orange">Demo</span> to distinguish
              live from sample data.
            </p>
          </section>
        </div>

        {/* Pinned footer action */}
        <div className="shrink-0 px-6 py-4 border-t border-border bg-card">
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-border text-foreground focus-visible:ring-qep-orange"
              onClick={onClose}
              disabled={isSaving || isClearingCredentials}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2] focus-visible:ring-[#DC2626]"
              onClick={() => void handleClearCredentials()}
              disabled={isSaving || isClearingCredentials || isTesting}
            >
              {isClearingCredentials ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />
                  Clearing…
                </>
              ) : (
                "Clear credentials"
              )}
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-qep-orange hover:bg-qep-orange-hover text-white focus-visible:ring-qep-orange"
              onClick={() => void handleSave()}
              disabled={isSaving || isClearingCredentials}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                "Save configuration"
              )}
            </Button>
          </div>
        </div>
      </SheetContent>

      <Dialog open={hubSpotImportDialogOpen} onOpenChange={setHubSpotImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run a new HubSpot import?</DialogTitle>
            <DialogDescription>
              This will import CRM records from HubSpot and may take a few minutes. We update existing records when they match and add new ones.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHubSpotImportDialogOpen(false)}
              disabled={isRunningHubSpotImport}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-qep-orange hover:bg-qep-orange-hover text-white focus-visible:ring-qep-orange"
              onClick={() => void runHubSpotImport()}
              disabled={isRunningHubSpotImport}
            >
              {isRunningHubSpotImport ? "Starting…" : "Confirm import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
