/**
 * IntegrationPanel — right-side drawer (desktop) / full-screen sheet (mobile).
 * Contains: connection status, credential form, sync scope toggles, audit log.
 * Per blueprint §6.2 and CDO design direction §1 (Drawer pattern).
 */

import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, Clock, Database, Copy } from "lucide-react";
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

interface HubSpotCutoverConfig {
  parallel_run_enabled?: boolean;
  cutover_ready?: boolean;
  validated_at?: string | null;
  note?: string | null;
}

interface HubSpotReasonSummary {
  reasonCode: string;
  count: number;
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

function formatHubSpotReasonLabel(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function hubspotReconciliationTone(errorCount: number): {
  cardClassName: string;
  labelClassName: string;
  label: string;
  nextAction: string;
} {
  if (errorCount === 0) {
    return {
      cardClassName: "border-[#BBF7D0] bg-[#F0FDF4]",
      labelClassName: "bg-[#DCFCE7] text-[#166534]",
      label: "Clear",
      nextAction: "Validation is clean. Use the cutover summary to decide when HubSpot can drop to source-only.",
    };
  }

  if (errorCount <= 3) {
    return {
      cardClassName: "border-[#FED7AA] bg-[#FFF7ED]",
      labelClassName: "bg-[#FFEDD5] text-[#9A3412]",
      label: "Needs review",
      nextAction: "Resolve the remaining mismatches, rerun validation, and confirm the cutover note reflects the final decision.",
    };
  }

  return {
    cardClassName: "border-[#FECACA] bg-[#FFF1F2]",
    labelClassName: "bg-[#FFE4E6] text-[#BE123C]",
    label: "Blocked",
    nextAction: "Keep parallel run active and reconcile the failing rows before marking cutover ready.",
  };
}

function formatHubSpotValidationDate(value: string): string {
  if (!value) return "Not validated";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Not validated";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function readHubSpotCutoverConfig(config: Record<string, unknown> | undefined): HubSpotCutoverConfig {
  if (!config || typeof config !== "object") {
    return {};
  }
  const raw = (config as Record<string, unknown>).hubspot_cutover;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return raw as HubSpotCutoverConfig;
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
  const [isCopyingCutoverPacket, setIsCopyingCutoverPacket] = useState(false);
  const [hubSpotImportResult, setHubSpotImportResult] = useState<HubSpotImportResult | null>(null);
  const [hubSpotImportError, setHubSpotImportError] = useState<string | null>(null);
  const [selectedResumeRunId, setSelectedResumeRunId] = useState<string | null>(null);
  const [selectedReviewRunId, setSelectedReviewRunId] = useState<string | null>(null);
  const [hubspotParallelRunEnabled, setHubspotParallelRunEnabled] = useState(true);
  const [hubspotCutoverReady, setHubspotCutoverReady] = useState(false);
  const [hubspotValidatedAt, setHubspotValidatedAt] = useState("");
  const [hubspotCutoverNote, setHubspotCutoverNote] = useState("");

  // Reset all panel state when the selected integration changes
  useEffect(() => {
    if (!integration) return;
    const currentScopes = SYNC_SCOPES[integration.key] ?? [];
    const cutover = readHubSpotCutoverConfig(integration.config);
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
    setSelectedReviewRunId(null);
    setHubspotParallelRunEnabled(cutover.parallel_run_enabled ?? true);
    setHubspotCutoverReady(cutover.cutover_ready ?? false);
    setHubspotValidatedAt(
      typeof cutover.validated_at === "string" && cutover.validated_at.length >= 10
        ? cutover.validated_at.slice(0, 10)
        : "",
    );
    setHubspotCutoverNote(
      typeof cutover.note === "string" ? cutover.note : "",
    );
  }, [integration?.key, integration?.config]);

  const isHubSpot = integration?.key === "hubspot";
  const resumableHubSpotRuns = hubSpotImportRuns.filter((run) =>
    HUBSPOT_RESUMABLE_STATUSES.has(run.status) && run.initiatedBy === actorUserId
  );

  useEffect(() => {
    if (!isHubSpot) {
      setSelectedResumeRunId(null);
      setSelectedReviewRunId(null);
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
  useEffect(() => {
    if (!isHubSpot) {
      setSelectedReviewRunId(null);
      return;
    }
    setSelectedReviewRunId((current) =>
      current && hubSpotImportRuns.some((run) => run.id === current)
        ? current
        : (hubSpotImportRuns[0]?.id ?? null)
    );
  }, [isHubSpot, hubSpotImportRuns]);

  if (!integration) return null;
  const activeReconciliationRunId = selectedReviewRunId ??
    hubSpotImportResult?.runId ??
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
  const errorCountByReason = activeRunErrors.reduce<Record<string, number>>((acc, error) => {
    acc[error.reasonCode] = (acc[error.reasonCode] ?? 0) + 1;
    return acc;
  }, {});
  const topReasonErrorRows = Object.entries(errorCountByReason)
    .map(([reasonCode, count]): HubSpotReasonSummary => ({ reasonCode, count }))
    .sort((a, b) => b.count - a.count);
  const latestFinishedRun = hubSpotImportRuns.find((run) =>
    run.status === "completed" || run.status === "completed_with_errors" || run.status === "failed"
  ) ?? null;
  const cutoverBlockingCount = activeRunErrors.length;
  const reconciliationTone = hubspotReconciliationTone(cutoverBlockingCount);
  const cutoverChecklist = [
    {
      label: "Parallel run",
      value: hubspotParallelRunEnabled ? "Still active" : "Ready to disable",
      tone: hubspotParallelRunEnabled ? "text-[#9A3412]" : "text-[#166534]",
    },
    {
      label: "Validation date",
      value: formatHubSpotValidationDate(hubspotValidatedAt),
      tone: hubspotValidatedAt ? "text-[#166534]" : "text-[#9A3412]",
    },
    {
      label: "Run issues",
      value: cutoverBlockingCount === 0 ? "No open reconciliation rows" : `${cutoverBlockingCount.toLocaleString()} rows still need review`,
      tone: cutoverBlockingCount === 0 ? "text-[#166534]" : "text-[#B91C1C]",
    },
    {
      label: "Cutover flag",
      value: hubspotCutoverReady ? "Ready for deploy gate" : "Still validating",
      tone: hubspotCutoverReady ? "text-[#166534]" : "text-[#9A3412]",
    },
  ];
  const cutoverSummaryReady =
    hubspotCutoverReady &&
    !hubspotParallelRunEnabled &&
    cutoverBlockingCount === 0 &&
    hubspotValidatedAt.trim().length > 0 &&
    hubspotCutoverNote.trim().length > 0;
  const cutoverMissingItems = [
    hubspotParallelRunEnabled ? "Disable parallel run after final validation." : null,
    hubspotValidatedAt.trim().length === 0 ? "Add a validation date." : null,
    cutoverBlockingCount > 0 ? `Resolve ${cutoverBlockingCount.toLocaleString()} reconciliation row${cutoverBlockingCount === 1 ? "" : "s"}.` : null,
    !hubspotCutoverReady ? "Flip the cutover-ready flag once the board approves." : null,
    hubspotCutoverNote.trim().length === 0 ? "Add a short validation note for the deploy gate." : null,
  ].filter((value): value is string => Boolean(value));
  const cutoverRecommendation = cutoverSummaryReady
    ? "Ready to move HubSpot into source-only mode once the deploy gate is open."
    : cutoverBlockingCount > 0
    ? "Do not cut over yet. Keep HubSpot in parallel run until the remaining reconciliation issues are resolved."
    : hubspotValidatedAt.trim().length === 0 || hubspotCutoverNote.trim().length === 0
    ? "Validation evidence is incomplete. Add the validation date and board-facing note before cutover."
    : hubspotParallelRunEnabled
    ? "Validation looks close. Finish the parallel-run review, then disable it before cutover."
    : "Validation is partially complete. Finish the remaining handoff items before cutover.";

  async function handleCopyCutoverPacket(): Promise<void> {
    if (!integration || !isHubSpot) {
      return;
    }

    const packet = [
      `${integration.name} cutover packet`,
      `Recommendation: ${cutoverRecommendation}`,
      `Packet status: ${cutoverSummaryReady ? "ready" : "not ready"}`,
      `Parallel run: ${hubspotParallelRunEnabled ? "active" : "disabled"}`,
      `Cutover ready flag: ${hubspotCutoverReady ? "yes" : "no"}`,
      `Validation date: ${hubspotValidatedAt.trim() || "not set"}`,
      `Review run: ${activeReconciliationRunId ?? "none"}`,
      `Open reconciliation rows: ${cutoverBlockingCount}`,
      `Latest finished run: ${
        latestFinishedRun
          ? `${hubspotRunStatusLabel(latestFinishedRun.status)} (${formatHubSpotRunCount(latestFinishedRun)} · ${formatHubSpotRunTimestamp(latestFinishedRun.completedAt ?? latestFinishedRun.startedAt)})`
          : "none"
      }`,
      `Validation note: ${hubspotCutoverNote.trim() || "not set"}`,
      cutoverMissingItems.length > 0
        ? `Remaining handoff items:\n- ${cutoverMissingItems.join("\n- ")}`
        : "Remaining handoff items:\n- None",
    ].join("\n");

    setIsCopyingCutoverPacket(true);
    try {
      await navigator.clipboard.writeText(packet);
      toast({
        title: "Cutover packet copied",
        description: "The current HubSpot cutover handoff summary is ready to paste into the board or deploy gate.",
      });
    } catch (error) {
      toast({
        title: "Could not copy cutover packet",
        description: error instanceof Error ? error.message : "Clipboard access failed.",
        variant: "destructive",
      });
    } finally {
      setIsCopyingCutoverPacket(false);
    }
  }

  async function handleSave() {
    if (!integration) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const updateBody: Record<string, unknown> = {
        action: "update_integration",
        integration_key: integration.key,
        endpoint_url: endpointUrl || null,
        sync_scopes: syncScopes,
      };

      let authType: "oauth_app" | "token" | "existing" = "existing";
      let statusAfter: "pending_credentials" | "unchanged" = "unchanged";

      if (isHubSpot) {
        const hasHubspotCredentialInput = Boolean(
          hubspotClientId.trim() || hubspotClientSecret.trim() || hubspotAppId.trim(),
        );
        if (hasHubspotCredentialInput) {
          if (
            !hubspotClientId.trim() || !hubspotClientSecret.trim() ||
            !hubspotAppId.trim()
          ) {
            throw new Error(
              "HubSpot client ID, client secret, and app ID are required.",
            );
          }
          updateBody.credentials = JSON.stringify({
            client_id: hubspotClientId.trim(),
            client_secret: hubspotClientSecret.trim(),
            app_id: hubspotAppId.trim(),
          });
          authType = "oauth_app";
          statusAfter = "pending_credentials";
        }
        updateBody.config_patch = {
          hubspot_cutover: {
            parallel_run_enabled: hubspotParallelRunEnabled,
            cutover_ready: hubspotCutoverReady,
            validated_at: hubspotValidatedAt.trim() || null,
            note: hubspotCutoverNote.trim() || null,
          },
        };
      } else if (credentials.trim().length > 0) {
        updateBody.credentials = credentials.trim();
        authType = "token";
        statusAfter = "pending_credentials";
      }

      const { error } = await supabase.functions.invoke("admin-users", {
        body: updateBody,
      });
      if (error) throw new Error(error.message);
      void trackIntegrationEvent("integration_credentials_saved", {
        integration_key: integration.key,
        auth_type: authType,
        status_after: statusAfter,
      });
      toast({
        title: "Configuration saved",
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
      setSelectedReviewRunId(result.runId);
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
                  {hubSpotImportRuns.length > 1 && (
                    <div className="mt-2 space-y-1">
                      <Label htmlFor="hubspot-review-run" className="text-[11px] font-medium text-[#475569]">
                        Review run
                      </Label>
                      <select
                        id="hubspot-review-run"
                        value={selectedReviewRunId ?? ""}
                        onChange={(event) => setSelectedReviewRunId(event.target.value || null)}
                        className="h-10 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
                      >
                        {hubSpotImportRuns.map((run) => (
                          <option key={run.id} value={run.id}>
                            {hubspotRunStatusLabel(run.status)} · {formatHubSpotRunTimestamp(run.completedAt ?? run.startedAt)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
                        <div className={cn("rounded-lg border p-3", reconciliationTone.cardClassName)}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-xs font-medium text-foreground">Reconciliation status</p>
                              <p className="mt-1 text-xs text-[#475569]">
                                Run {activeReconciliationRunId.slice(0, 8)} is the current cutover validation source.
                              </p>
                            </div>
                            <span className={cn("inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold", reconciliationTone.labelClassName)}>
                              {reconciliationTone.label}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <div className="rounded border border-white/70 bg-white px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">Error rows</p>
                              <p className="mt-1 text-sm font-semibold text-[#0F172A]">
                                {activeRunErrors.length.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded border border-white/70 bg-white px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">Top reason</p>
                              <p className="mt-1 text-sm font-semibold text-[#0F172A]">
                                {topReasonErrorRows[0] ? formatHubSpotReasonLabel(topReasonErrorRows[0].reasonCode) : "None"}
                              </p>
                            </div>
                            <div className="rounded border border-white/70 bg-white px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">Top entity</p>
                              <p className="mt-1 text-sm font-semibold text-[#0F172A]">
                                {topEntityErrorRows[0]?.entityType ?? "None"}
                              </p>
                            </div>
                          </div>
                          <p className="mt-3 text-xs text-[#475569]">{reconciliationTone.nextAction}</p>
                        </div>

                        <p className="text-[11px] text-[#64748B]">
                          Run {activeReconciliationRunId.slice(0, 8)} has{" "}
                          {activeRunErrors.length.toLocaleString()} error rows.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {topEntityErrorRows.slice(0, 4).map((row) => (
                            <div
                              key={`entity-${row.entityType}`}
                              className="flex items-center justify-between rounded border border-border px-2 py-1 text-[11px]"
                            >
                              <span className="font-medium text-foreground">{row.entityType}</span>
                              <span className="text-[#B91C1C]">{row.count.toLocaleString()}</span>
                            </div>
                          ))}
                          {topReasonErrorRows.slice(0, 4).map((row) => (
                            <div
                              key={`reason-${row.reasonCode}`}
                              className="flex items-center justify-between rounded border border-border px-2 py-1 text-[11px]"
                            >
                              <span className="font-medium text-foreground">{formatHubSpotReasonLabel(row.reasonCode)}</span>
                              <span className="text-[#B91C1C]">{row.count.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-2">
                          {activeRunErrors.slice(0, 3).map((error) => (
                            <div key={error.id} className="rounded border border-[#FECACA] bg-white px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#BE123C]">
                                  {formatHubSpotReasonLabel(error.reasonCode)}
                                </span>
                                <span className="text-[10px] text-[#64748B]">
                                  {new Date(error.createdAt).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] font-medium text-[#881337]">
                                {error.entityType}
                              </p>
                              <p className="mt-1 text-[11px] text-[#4C0519]">
                                {error.message ?? "No message provided."}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                <div
                  className={cn(
                    "mt-3 rounded-lg border p-3",
                    cutoverSummaryReady
                      ? "border-[#BBF7D0] bg-[#F0FDF4]"
                      : "border-[#FED7AA] bg-[#FFF7ED]",
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-medium text-foreground">Cutover summary</p>
                      <p className="mt-1 text-xs text-[#64748B]">
                        Keep the migration decision in one place before HubSpot becomes source-only.
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold",
                        cutoverSummaryReady
                          ? "bg-[#DCFCE7] text-[#166534]"
                          : "bg-[#FFEDD5] text-[#9A3412]",
                      )}
                    >
                      {cutoverSummaryReady ? "Cutover packet ready" : "Parallel-run review in progress"}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {cutoverChecklist.map((item) => (
                      <div key={item.label} className="rounded border border-white/70 bg-white px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                          {item.label}
                        </p>
                        <p className={cn("mt-1 text-sm font-semibold", item.tone)}>{item.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 rounded border border-white/70 bg-white px-3 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                          Recommendation
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopyCutoverPacket()}
                        disabled={isCopyingCutoverPacket}
                        className="border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]"
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                        {isCopyingCutoverPacket ? "Copying..." : "Copy packet"}
                      </Button>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-[#0F172A]">{cutoverRecommendation}</p>
                    {cutoverMissingItems.length > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                          Remaining handoff items
                        </p>
                        <ul className="space-y-1 text-sm text-[#334155]">
                          {cutoverMissingItems.map((item) => (
                            <li key={item} className="flex gap-2">
                              <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-[#E87722]" aria-hidden="true" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-[#166534]">
                        No remaining handoff items are blocking the cutover package.
                      </p>
                    )}
                  </div>

                  {(latestFinishedRun || hubspotCutoverNote.trim().length > 0) && (
                    <div className="mt-3 space-y-2">
                      {latestFinishedRun && (
                        <div className="rounded border border-white/70 bg-white px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                            Latest finished run
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[#0F172A]">
                            {hubspotRunStatusLabel(latestFinishedRun.status)}
                          </p>
                          <p className="mt-1 text-xs text-[#475569]">
                            {formatHubSpotRunCount(latestFinishedRun)} • {formatHubSpotRunTimestamp(latestFinishedRun.completedAt ?? latestFinishedRun.startedAt)}
                          </p>
                        </div>
                      )}
                      {hubspotCutoverNote.trim().length > 0 && (
                        <div className="rounded border border-white/70 bg-white px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                            Validation note
                          </p>
                          <p className="mt-1 text-sm text-[#334155]">{hubspotCutoverNote.trim()}</p>
                        </div>
                      )}
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

                <div className="mt-3 rounded-lg border border-border bg-card p-3">
                  <p className="text-xs font-medium text-foreground">Parallel-run controls</p>
                  <p className="mt-1 text-xs text-[#64748B]">
                    Track validation state before HubSpot cutover.
                  </p>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center justify-between gap-3 rounded border border-border px-2.5 py-2">
                      <span className="text-xs text-[#334155]">Parallel run active</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={hubspotParallelRunEnabled}
                        aria-label="Toggle HubSpot parallel run mode"
                        onClick={() => setHubspotParallelRunEnabled((value) => !value)}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
                          hubspotParallelRunEnabled ? "bg-qep-orange" : "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none block h-4 w-4 rounded-full bg-card shadow-sm transition-transform duration-200 mt-0.5",
                            hubspotParallelRunEnabled ? "translate-x-[18px]" : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border border-border px-2.5 py-2">
                      <span className="text-xs text-[#334155]">Cutover ready</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={hubspotCutoverReady}
                        aria-label="Toggle HubSpot cutover readiness"
                        onClick={() => setHubspotCutoverReady((value) => !value)}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
                          hubspotCutoverReady ? "bg-qep-orange" : "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none block h-4 w-4 rounded-full bg-card shadow-sm transition-transform duration-200 mt-0.5",
                            hubspotCutoverReady ? "translate-x-[18px]" : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </label>

                    <div className="space-y-1">
                      <Label htmlFor="hubspot-validated-at" className="text-xs font-medium text-[#374151]">
                        Validation Date
                      </Label>
                      <Input
                        id="hubspot-validated-at"
                        type="date"
                        value={hubspotValidatedAt}
                        onChange={(event) => setHubspotValidatedAt(event.target.value)}
                        className="text-sm focus-visible:ring-qep-orange"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="hubspot-cutover-note" className="text-xs font-medium text-[#374151]">
                        Validation Notes
                      </Label>
                      <Input
                        id="hubspot-cutover-note"
                        type="text"
                        placeholder="Parallel-run summary for board/deploy gate"
                        value={hubspotCutoverNote}
                        onChange={(event) => setHubspotCutoverNote(event.target.value)}
                        className="text-sm focus-visible:ring-qep-orange"
                      />
                    </div>
                  </div>
                </div>
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
                      <span className="text-[#64748B] ml-1">(optional)</span>
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
                      <span className="text-[#64748B] ml-1">(optional)</span>
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
                      <span className="text-[#64748B] ml-1">(optional)</span>
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
                    webhook verification, and token refresh. Leave blank to keep existing credentials.
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
