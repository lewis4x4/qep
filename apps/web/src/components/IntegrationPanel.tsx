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
import { BRAND_NAME } from "@/components/BrandLogo";

// Per-integration sync scope definitions
const SYNC_SCOPES: Record<string, { key: string; label: string; description: string }[]> = {
  hubspot: [
    { key: "companies", label: "Companies", description: "Account records from HubSpot QRM" },
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
  deploy_gate_ready?: boolean;
  source_only_enabled?: boolean;
  source_only_activated_at?: string | null;
  validated_at?: string | null;
  note?: string | null;
  decision?: HubSpotCutoverDecision | null;
  decision_note?: string | null;
}

type HubSpotCutoverDecision =
  | "hold_parallel_run"
  | "open_deploy_gate"
  | "switch_source_only"
  | "source_only_live"
  | "rollback_validation";

interface HubSpotCutoverSnapshot {
  parallelRunEnabled: boolean;
  cutoverReady: boolean;
  deployGateReady: boolean;
  sourceOnlyEnabled: boolean;
  sourceOnlyActivatedAt: string;
  validatedAt: string;
  note: string;
  decision: HubSpotCutoverDecision;
  decisionNote: string;
}

interface HubSpotReasonSummary {
  reasonCode: string;
  count: number;
}

interface IntegrationCredentialAuditEventRow {
  id: string;
  event_type:
    | "credentials_set"
    | "credentials_rotated"
    | "credentials_cleared"
    | "deploy_gate_approved"
    | "source_only_enabled"
    | "parallel_run_reopened";
  actor_role: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}

function statusToDataSource(status: IntegrationCardConfig["status"]): DataSourceState {
  switch (status) {
    case "connected": return "Live";
    case "demo_mode": return "Demo";
    case "replaced": return "Native";
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
      return "text-green-700 dark:text-green-400";
    case "completed_with_errors":
      return "text-primary";
    case "failed":
      return "text-destructive";
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
      cardClassName: "border-emerald-400/40 bg-emerald-500/10",
      labelClassName: "bg-[#DCFCE7] text-green-700 dark:text-green-400",
      label: "Clear",
      nextAction: "Validation is clean. Use the cutover summary to decide when HubSpot can drop to source-only.",
    };
  }

  if (errorCount <= 3) {
    return {
      cardClassName: "border-[#FED7AA] bg-primary/10",
      labelClassName: "bg-[#FFEDD5] text-primary",
      label: "Needs review",
      nextAction: "Resolve the remaining mismatches, rerun validation, and confirm the cutover note reflects the final decision.",
    };
  }

  return {
    cardClassName: "border-[#FECACA] bg-rose-500/10",
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

function formatPanelTimestamp(value: string): string {
  if (!value) return "Time unavailable";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatHubSpotValidationDate(value);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function sortablePanelTimestamp(value: string): number {
  if (!value) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(`${value}T12:00:00Z`);
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function integrationCredentialAuditLabel(
  eventType: IntegrationCredentialAuditEventRow["event_type"],
): string {
  switch (eventType) {
    case "credentials_set":
      return "Credentials added";
    case "credentials_rotated":
      return "Credentials rotated";
    case "credentials_cleared":
      return "Credentials cleared";
    case "deploy_gate_approved":
      return "Deploy gate approved";
    case "source_only_enabled":
      return "HubSpot moved to source-only";
    case "parallel_run_reopened":
      return "Parallel run reopened";
    default:
      return "Credential update";
  }
}

function integrationHistorySortPriority(eventType: IntegrationCredentialAuditEventRow["event_type"]): number {
  switch (eventType) {
    case "source_only_enabled":
      return 60;
    case "deploy_gate_approved":
      return 50;
    case "parallel_run_reopened":
      return 40;
    case "credentials_cleared":
      return 30;
    case "credentials_rotated":
      return 20;
    case "credentials_set":
      return 10;
    default:
      return 0;
  }
}

function defaultHubSpotCutoverDecision(params: {
  parallelRunEnabled: boolean;
  cutoverReady: boolean;
  deployGateReady: boolean;
  sourceOnlyEnabled: boolean;
}): HubSpotCutoverDecision {
  if (params.sourceOnlyEnabled) {
    return "source_only_live";
  }
  if (params.deployGateReady) {
    return "switch_source_only";
  }
  if (params.cutoverReady) {
    return "open_deploy_gate";
  }
  if (params.parallelRunEnabled) {
    return "hold_parallel_run";
  }
  return "rollback_validation";
}

function normalizeHubSpotCutoverDecision(
  value: string | null | undefined,
  fallback: HubSpotCutoverDecision,
): HubSpotCutoverDecision {
  switch (value) {
    case "hold_parallel_run":
    case "open_deploy_gate":
    case "switch_source_only":
    case "source_only_live":
    case "rollback_validation":
      return value;
    default:
      return fallback;
  }
}

function hubspotCutoverDecisionLabel(decision: HubSpotCutoverDecision): string {
  switch (decision) {
    case "hold_parallel_run":
      return "Hold in parallel run";
    case "open_deploy_gate":
      return "Open deploy gate";
    case "switch_source_only":
      return "Switch to source-only";
    case "source_only_live":
      return "Confirm source-only handoff";
    case "rollback_validation":
      return "Rollback for more validation";
    default:
      return "Hold in parallel run";
  }
}

function hubspotCutoverDecisionDescription(decision: HubSpotCutoverDecision): string {
  switch (decision) {
    case "hold_parallel_run":
      return "Keep HubSpot active for operators while validation continues.";
    case "open_deploy_gate":
      return "Validation is ready for approval, but operations has not switched the source mode yet.";
    case "switch_source_only":
      return "The handoff package is approved and the next move is the source-only switch.";
    case "source_only_live":
      return "Use this once the switch is complete and the board packet should reflect the live handoff.";
    case "rollback_validation":
      return "Reopen validation, fix the handoff blockers, and keep the board informed.";
    default:
      return "Keep HubSpot active for operators while validation continues.";
  }
}

function allowedHubSpotCutoverDecisions(params: {
  parallelRunEnabled: boolean;
  cutoverPacketReady: boolean;
  deployGateReady: boolean;
  sourceOnlyEnabled: boolean;
}): HubSpotCutoverDecision[] {
  if (params.sourceOnlyEnabled) {
    return ["source_only_live"];
  }
  if (params.deployGateReady && params.cutoverPacketReady) {
    return ["switch_source_only", "rollback_validation"];
  }
  if (params.cutoverPacketReady) {
    return ["open_deploy_gate", "rollback_validation"];
  }
  if (params.parallelRunEnabled) {
    return ["hold_parallel_run", "rollback_validation"];
  }
  return ["rollback_validation"];
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
  const [isRunningOneDriveSync, setIsRunningOneDriveSync] = useState(false);
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
  const [hubspotDeployGateReady, setHubspotDeployGateReady] = useState(false);
  const [hubspotSourceOnlyEnabled, setHubspotSourceOnlyEnabled] = useState(false);
  const [hubspotSourceOnlyActivatedAt, setHubspotSourceOnlyActivatedAt] = useState("");
  const [hubspotValidatedAt, setHubspotValidatedAt] = useState("");
  const [hubspotCutoverNote, setHubspotCutoverNote] = useState("");
  const [hubspotCutoverDecision, setHubspotCutoverDecision] = useState<HubSpotCutoverDecision>("hold_parallel_run");
  const [hubspotCutoverDecisionNote, setHubspotCutoverDecisionNote] = useState("");
  const [hubspotCutoverSnapshot, setHubspotCutoverSnapshot] = useState<HubSpotCutoverSnapshot | null>(null);
  const [showHubspotCutoverDetails, setShowHubspotCutoverDetails] = useState(false);
  const [recentCredentialAuditEvents, setRecentCredentialAuditEvents] = useState<IntegrationCredentialAuditEventRow[]>([]);
  const [isLoadingCredentialAudit, setIsLoadingCredentialAudit] = useState(false);
  const [credentialAuditError, setCredentialAuditError] = useState<string | null>(null);

  // Reset all panel state when the selected integration changes
  useEffect(() => {
    if (!integration) return;
    const currentScopes = SYNC_SCOPES[integration.key] ?? [];
    const cutover = readHubSpotCutoverConfig(integration.config);
    const normalizedSourceOnlyEnabled = cutover.source_only_enabled ?? false;
    const normalizedCutoverReady = normalizedSourceOnlyEnabled
      ? true
      : (cutover.cutover_ready ?? false);
    const normalizedDeployGateReady = normalizedSourceOnlyEnabled
      ? true
      : (cutover.deploy_gate_ready ?? false);
    const normalizedParallelRunEnabled = normalizedSourceOnlyEnabled
      ? false
      : (cutover.parallel_run_enabled ?? true);
    const normalizedDecision = normalizeHubSpotCutoverDecision(
      typeof cutover.decision === "string" ? cutover.decision : null,
      defaultHubSpotCutoverDecision({
        parallelRunEnabled: normalizedParallelRunEnabled,
        cutoverReady: normalizedCutoverReady,
        deployGateReady: normalizedDeployGateReady,
        sourceOnlyEnabled: normalizedSourceOnlyEnabled,
      }),
    );
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
    setHubspotParallelRunEnabled(normalizedParallelRunEnabled);
    setHubspotCutoverReady(normalizedCutoverReady);
    setHubspotDeployGateReady(normalizedDeployGateReady);
    setHubspotSourceOnlyEnabled(normalizedSourceOnlyEnabled);
    setHubspotSourceOnlyActivatedAt(
      normalizedSourceOnlyEnabled &&
        typeof cutover.source_only_activated_at === "string" &&
        cutover.source_only_activated_at.length >= 10
        ? cutover.source_only_activated_at.slice(0, 10)
        : "",
    );
    setHubspotValidatedAt(
      typeof cutover.validated_at === "string" && cutover.validated_at.length >= 10
        ? cutover.validated_at.slice(0, 10)
        : "",
    );
    setHubspotCutoverNote(
      typeof cutover.note === "string" ? cutover.note : "",
    );
    setHubspotCutoverDecision(normalizedDecision);
    setHubspotCutoverDecisionNote(
      typeof cutover.decision_note === "string" ? cutover.decision_note : "",
    );
    setShowHubspotCutoverDetails(false);
    setHubspotCutoverSnapshot({
      parallelRunEnabled: normalizedParallelRunEnabled,
      cutoverReady: normalizedCutoverReady,
      deployGateReady: normalizedDeployGateReady,
      sourceOnlyEnabled: normalizedSourceOnlyEnabled,
      sourceOnlyActivatedAt:
        normalizedSourceOnlyEnabled &&
          typeof cutover.source_only_activated_at === "string" &&
          cutover.source_only_activated_at.length >= 10
          ? cutover.source_only_activated_at.slice(0, 10)
          : "",
      validatedAt:
        typeof cutover.validated_at === "string" && cutover.validated_at.length >= 10
          ? cutover.validated_at.slice(0, 10)
          : "",
      note: typeof cutover.note === "string" ? cutover.note : "",
      decision: normalizedDecision,
      decisionNote: typeof cutover.decision_note === "string" ? cutover.decision_note : "",
    });
  }, [integration?.key, integration?.config]);

  const replacement = integration?.replacement ?? null;
  const isReplaced = replacement !== null;
  const isHubSpot = integration?.key === "hubspot" && !isReplaced;
  const isOneDrive = integration?.key === "onedrive";
  const resumableHubSpotRuns = hubSpotImportRuns.filter((run) =>
    HUBSPOT_RESUMABLE_STATUSES.has(run.status) && run.initiatedBy === actorUserId
  );
  const oneDriveSyncStateId =
    typeof integration?.config?.sync_state_id === "string" ? integration.config.sync_state_id : null;
  const oneDriveConnectUrl = import.meta.env.VITE_MSGRAPH_CLIENT_ID
    ? `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${import.meta.env.VITE_MSGRAPH_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(window.location.origin + "/auth/onedrive/callback")}&scope=files.read.all+offline_access&response_mode=query`
    : null;

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

  useEffect(() => {
    if (!open || !integration) {
      setRecentCredentialAuditEvents([]);
      setIsLoadingCredentialAudit(false);
      setCredentialAuditError(null);
      return;
    }

    let isCancelled = false;
    setIsLoadingCredentialAudit(true);
    setCredentialAuditError(null);

    void (async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            eq: (column: string, value: string) => {
              order: (
                column: string,
                options: { ascending: boolean },
              ) => {
                limit: (count: number) => Promise<{
                  data: IntegrationCredentialAuditEventRow[] | null;
                  error: { message?: string } | null;
                }>;
              };
            };
          };
        };
      })
        .from("integration_status_credential_audit_events")
        .select("id, event_type, actor_role, metadata, occurred_at")
        .eq("integration_key", integration.key)
        .order("occurred_at", { ascending: false })
        .limit(5);

      if (isCancelled) {
        return;
      }

      if (error) {
        console.error("Failed to load integration credential audit events", error);
        setRecentCredentialAuditEvents([]);
        setCredentialAuditError(error.message ?? "Could not load execution history.");
      } else {
        setRecentCredentialAuditEvents(data ?? []);
        setCredentialAuditError(null);
      }
      setIsLoadingCredentialAudit(false);
    })();

    return () => {
      isCancelled = true;
    };
  }, [open, integration?.key]);

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
  const normalizedCutoverDecision = normalizeHubSpotCutoverDecision(
    hubspotCutoverDecision,
    defaultHubSpotCutoverDecision({
      parallelRunEnabled: hubspotParallelRunEnabled,
      cutoverReady: hubspotCutoverReady,
      deployGateReady: hubspotDeployGateReady,
      sourceOnlyEnabled: hubspotSourceOnlyEnabled,
    }),
  );
  const cutoverPacketReady =
    hubspotCutoverReady &&
    !hubspotParallelRunEnabled &&
    cutoverBlockingCount === 0 &&
    hubspotValidatedAt.trim().length > 0 &&
    hubspotCutoverNote.trim().length > 0;
  const effectiveDeployGateReady = hubspotSourceOnlyEnabled
    ? true
    : (hubspotDeployGateReady && cutoverPacketReady);
  const allowedCutoverDecisions = allowedHubSpotCutoverDecisions({
    parallelRunEnabled: hubspotParallelRunEnabled,
    cutoverPacketReady,
    deployGateReady: effectiveDeployGateReady,
    sourceOnlyEnabled: hubspotSourceOnlyEnabled,
  });
  const effectiveCutoverDecision = allowedCutoverDecisions.includes(normalizedCutoverDecision)
    ? normalizedCutoverDecision
    : allowedCutoverDecisions[0];
  const cutoverDecisionLabel = hubspotCutoverDecisionLabel(effectiveCutoverDecision);
  const cutoverDecisionDescription = hubspotCutoverDecisionDescription(effectiveCutoverDecision);
  const cutoverChecklist = [
    {
      label: "Parallel run",
      value: hubspotParallelRunEnabled ? "Still active" : "Ready to disable",
      tone: hubspotParallelRunEnabled ? "text-primary" : "text-green-700 dark:text-green-400",
    },
    {
      label: "Validation date",
      value: formatHubSpotValidationDate(hubspotValidatedAt),
      tone: hubspotValidatedAt ? "text-green-700 dark:text-green-400" : "text-primary",
    },
    {
      label: "Run issues",
      value: cutoverBlockingCount === 0 ? "No open reconciliation rows" : `${cutoverBlockingCount.toLocaleString()} rows still need review`,
      tone: cutoverBlockingCount === 0 ? "text-green-700 dark:text-green-400" : "text-destructive",
    },
    {
      label: "Cutover flag",
      value: hubspotCutoverReady ? "Ready for deploy gate" : "Still validating",
      tone: hubspotCutoverReady ? "text-green-700 dark:text-green-400" : "text-primary",
    },
    {
      label: "Deploy gate",
      value: effectiveDeployGateReady ? "Approved for handoff" : "Pending approval",
      tone: effectiveDeployGateReady ? "text-green-700 dark:text-green-400" : "text-primary",
    },
    {
      label: "HubSpot mode",
      value: hubspotSourceOnlyEnabled
        ? `Source-only since ${formatHubSpotValidationDate(hubspotSourceOnlyActivatedAt)}`
        : "Still active for operators",
      tone: hubspotSourceOnlyEnabled ? "text-green-700 dark:text-green-400" : "text-primary",
    },
    {
      label: "Handoff call",
      value: cutoverDecisionLabel,
      tone: effectiveCutoverDecision === "rollback_validation"
        ? "text-destructive"
        : effectiveCutoverDecision === "hold_parallel_run"
        ? "text-primary"
        : "text-green-700 dark:text-green-400",
    },
  ];
  const cutoverHandoffReady = cutoverPacketReady && effectiveDeployGateReady;
  const hubspotCutoverDirty =
    hubspotCutoverSnapshot !== null && (
      hubspotCutoverSnapshot.parallelRunEnabled !== hubspotParallelRunEnabled ||
      hubspotCutoverSnapshot.cutoverReady !== hubspotCutoverReady ||
      hubspotCutoverSnapshot.deployGateReady !== hubspotDeployGateReady ||
      hubspotCutoverSnapshot.sourceOnlyEnabled !== hubspotSourceOnlyEnabled ||
      hubspotCutoverSnapshot.sourceOnlyActivatedAt !== hubspotSourceOnlyActivatedAt.trim() ||
      hubspotCutoverSnapshot.validatedAt !== hubspotValidatedAt.trim() ||
      hubspotCutoverSnapshot.note !== hubspotCutoverNote.trim() ||
      hubspotCutoverSnapshot.decision !== effectiveCutoverDecision ||
      hubspotCutoverSnapshot.decisionNote !== hubspotCutoverDecisionNote.trim()
    );
  const cutoverStageLabel = hubspotSourceOnlyEnabled
    ? "HubSpot source-only active"
    : cutoverHandoffReady
    ? "Ready for source-only switch"
    : cutoverPacketReady
    ? "Packet ready for deploy gate"
    : "Parallel-run review in progress";
  const cutoverStageTone = hubspotSourceOnlyEnabled
    ? "bg-[#DCFCE7] text-green-700 dark:text-green-400"
    : cutoverHandoffReady
    ? "bg-[#DBEAFE] text-[#1D4ED8]"
    : cutoverPacketReady
    ? "bg-[#FEF3C7] text-amber-800 dark:text-amber-200"
    : "bg-[#FFEDD5] text-primary";
  const cutoverMissingItems = [
    hubspotParallelRunEnabled ? "Disable parallel run after final validation." : null,
    hubspotValidatedAt.trim().length === 0 ? "Add a validation date." : null,
    cutoverBlockingCount > 0 ? `Resolve ${cutoverBlockingCount.toLocaleString()} reconciliation row${cutoverBlockingCount === 1 ? "" : "s"}.` : null,
    !hubspotCutoverReady ? "Flip the cutover-ready flag once the board approves." : null,
    hubspotCutoverNote.trim().length === 0 ? "Add a short validation note for the deploy gate." : null,
    hubspotCutoverDecisionNote.trim().length === 0 ? "Add an owner-facing handoff note." : null,
    cutoverPacketReady && !effectiveDeployGateReady ? "Mark the deploy gate approved when handoff is cleared." : null,
    hubspotSourceOnlyEnabled && hubspotSourceOnlyActivatedAt.trim().length === 0 ? "Record the HubSpot source-only transition date." : null,
    cutoverHandoffReady && !hubspotSourceOnlyEnabled ? "Switch HubSpot into source-only mode after the deploy gate opens." : null,
  ].filter((value): value is string => Boolean(value));
  const cutoverRecommendation = hubspotSourceOnlyEnabled || effectiveCutoverDecision === "source_only_live"
    ? "HubSpot is in source-only mode. Keep the packet attached while post-cutover validation runs."
    : effectiveCutoverDecision === "rollback_validation"
    ? "Do not cut over yet. Reopen validation, keep HubSpot active for operators, and close the remaining blockers."
    : effectiveCutoverDecision === "switch_source_only"
    ? cutoverHandoffReady
      ? "Deploy gate is clear. Switch HubSpot into source-only mode and record the transition date."
      : "The operator call is to switch HubSpot to source-only, but the handoff package is not fully ready yet."
    : effectiveCutoverDecision === "open_deploy_gate"
    ? cutoverPacketReady
      ? "The cutover packet is complete. Open the deploy gate and hand the switch plan to operations."
      : "The operator call is to open the deploy gate, but validation evidence is still incomplete."
    : cutoverBlockingCount > 0
    ? "Do not cut over yet. Keep HubSpot in parallel run until the remaining reconciliation issues are resolved."
    : hubspotValidatedAt.trim().length === 0 || hubspotCutoverNote.trim().length === 0
    ? "Validation evidence is incomplete. Add the validation date and board-facing note before cutover."
    : "Keep HubSpot in parallel run until the final handoff call changes.";
  const hubspotHistoryItems = isHubSpot
    ? [
        ...[...hubSpotImportRuns]
          .sort((left, right) =>
            sortablePanelTimestamp(right.completedAt ?? right.startedAt) -
            sortablePanelTimestamp(left.completedAt ?? left.startedAt)
          )
          .slice(0, 3)
          .map((run) => ({
          id: `hubspot-run-${run.id}`,
          title: `Import ${hubspotRunStatusLabel(run.status)}`,
          detail: `${formatHubSpotRunCount(run)}${run.errorCount > 0 ? ` • ${run.errorCount.toLocaleString()} errors` : ""}`,
          occurredAt: run.completedAt ?? run.startedAt,
          sortPriority: 5,
          tone: run.status === "failed"
            ? ("danger" as const)
            : run.status === "completed_with_errors"
            ? ("warning" as const)
            : run.status === "completed"
            ? ("success" as const)
            : ("neutral" as const),
        })),
        ...recentCredentialAuditEvents.map((event) => ({
          id: event.id,
          title: integrationCredentialAuditLabel(event.event_type),
          detail:
            event.event_type === "deploy_gate_approved"
              ? `Approved by ${event.actor_role ?? "system"}${typeof event.metadata?.validated_at === "string" && event.metadata.validated_at ? ` after validation dated ${formatHubSpotValidationDate(event.metadata.validated_at)}` : ""}.`
              : event.event_type === "source_only_enabled"
              ? `Marked by ${event.actor_role ?? "system"}${typeof event.metadata?.source_only_activated_at === "string" && event.metadata.source_only_activated_at ? ` on ${formatPanelTimestamp(event.metadata.source_only_activated_at)}` : ""}.`
              : event.event_type === "parallel_run_reopened"
              ? `Rolled back by ${event.actor_role ?? "system"} so validation can continue.`
              : event.actor_role
              ? `Changed by ${event.actor_role}.`
              : "Credential lifecycle event recorded.",
          occurredAt: event.occurred_at,
          sortPriority: integrationHistorySortPriority(event.event_type),
          tone:
            event.event_type === "source_only_enabled"
              ? ("success" as const)
              : event.event_type === "deploy_gate_approved"
              ? ("neutral" as const)
              : event.event_type === "parallel_run_reopened" || event.event_type === "credentials_cleared"
            ? ("warning" as const)
            : ("neutral" as const),
        })),
      ]
        .sort((left, right) => {
          const timestampDiff = sortablePanelTimestamp(right.occurredAt) - sortablePanelTimestamp(left.occurredAt);
          if (timestampDiff !== 0) {
            return timestampDiff;
          }
          const priorityDiff = (right.sortPriority ?? 0) - (left.sortPriority ?? 0);
          if (priorityDiff !== 0) {
            return priorityDiff;
          }
          return right.id.localeCompare(left.id);
        })
        .slice(0, 6)
    : [];

  async function handleCopyCutoverPacket(): Promise<void> {
    if (!integration || !isHubSpot) {
      return;
    }

    const packet = [
      `${integration.name} cutover packet`,
      `Stage: ${cutoverStageLabel}`,
      `Recommendation: ${cutoverRecommendation}`,
      `Packet status: ${cutoverPacketReady ? "ready" : "not ready"}`,
      `Deploy gate approved: ${effectiveDeployGateReady ? "yes" : "no"}`,
      `HubSpot source-only: ${hubspotSourceOnlyEnabled ? "yes" : "no"}`,
      `Source-only date: ${hubspotSourceOnlyActivatedAt.trim() || "not set"}`,
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
      `Handoff call: ${cutoverDecisionLabel}`,
      `Handoff note: ${hubspotCutoverDecisionNote.trim() || "not set"}`,
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

  function handleApproveDeployGate(): void {
    if (!cutoverPacketReady) {
      toast({
        title: "Cutover packet is not ready",
        description: "Finish validation, clear reconciliation, and disable parallel run before approving the deploy gate.",
        variant: "destructive",
      });
      return;
    }

    setHubspotDeployGateReady(true);
    setHubspotCutoverDecision("switch_source_only");
    setHubspotCutoverDecisionNote((current) =>
      current.trim().length > 0
        ? current
        : "Validation is complete and the deploy gate is approved. Operations can move HubSpot to source-only when the switch window opens.",
    );
    toast({
      title: "Deploy gate approved",
      description: "HubSpot is cleared for the source-only handoff step.",
    });
  }

  function handleEnableSourceOnly(): void {
    if (!cutoverHandoffReady) {
      toast({
        title: "Deploy gate approval required",
        description: "Approve the deploy gate before switching HubSpot into source-only mode.",
        variant: "destructive",
      });
      return;
    }

    setHubspotSourceOnlyEnabled(true);
    setHubspotSourceOnlyActivatedAt((current) => current || new Date().toISOString().slice(0, 10));
    setHubspotCutoverDecision("source_only_live");
    setHubspotCutoverDecisionNote((current) =>
      current.trim().length > 0
        ? current
        : `HubSpot is now source-only. Operators should stay in ${BRAND_NAME} while post-cutover validation runs.`,
    );
    toast({
      title: "HubSpot moved to source-only",
      description: "The handoff state is now recorded in the cutover package.",
    });
  }

  function handleReopenParallelRun(): void {
    setHubspotSourceOnlyEnabled(false);
    setHubspotSourceOnlyActivatedAt("");
    setHubspotDeployGateReady(false);
    setHubspotParallelRunEnabled(true);
    setHubspotCutoverReady(false);
    setHubspotCutoverDecision("rollback_validation");
    setHubspotCutoverDecisionNote((current) =>
      current.trim().length > 0
        ? current
        : "The handoff has been rolled back. HubSpot stays active for operators while validation continues.",
    );
    toast({
      title: "Parallel run reopened",
      description: "The cutover handoff has been rolled back so validation can continue.",
    });
  }

  async function handleSave(options?: { closeOnSuccess?: boolean }) {
    if (!integration) return;
    const closeOnSuccess = options?.closeOnSuccess ?? true;

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
            deploy_gate_ready: effectiveDeployGateReady,
            source_only_enabled: hubspotSourceOnlyEnabled,
            source_only_activated_at: hubspotSourceOnlyActivatedAt.trim() || null,
            validated_at: hubspotValidatedAt.trim() || null,
            note: hubspotCutoverNote.trim() || null,
            decision: effectiveCutoverDecision,
            decision_note: hubspotCutoverDecisionNote.trim() || null,
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
      if (isHubSpot) {
        setHubspotCutoverSnapshot({
          parallelRunEnabled: hubspotParallelRunEnabled,
          cutoverReady: hubspotCutoverReady,
          deployGateReady: hubspotDeployGateReady,
          sourceOnlyEnabled: hubspotSourceOnlyEnabled,
          sourceOnlyActivatedAt: hubspotSourceOnlyActivatedAt.trim(),
          validatedAt: hubspotValidatedAt.trim(),
          note: hubspotCutoverNote.trim(),
          decision: effectiveCutoverDecision,
          decisionNote: hubspotCutoverDecisionNote.trim(),
        });
      }
      onSaved();
      if (closeOnSuccess) {
        onClose();
      }
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
      if (isOneDrive) {
        const { data, error } = await supabase.functions.invoke<TestConnectionResponse>(
          "integration-test-connection",
          {
            body: {
              integration_key: "onedrive",
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
            title: "OneDrive is reachable",
            description: `Microsoft Graph responded in ${result.latencyMs}ms.`,
          });
        } else {
          toast({
            title: "OneDrive test failed",
            description: result.error ?? "Reconnect OneDrive and try again.",
            variant: "destructive",
          });
        }
        await onSaved();
        return;
      }

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

  async function handleRunOneDriveSync(): Promise<void> {
    if (!oneDriveSyncStateId) {
      toast({
        title: "Connect OneDrive first",
        description: "This workspace needs an active OneDrive authorization before sync can run.",
        variant: "destructive",
      });
      return;
    }

    setIsRunningOneDriveSync(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ success: boolean; processed: string[] }>(
        "ingest",
        {
          body: {
            action: "onedrive_sync",
            syncStateId: oneDriveSyncStateId,
          },
        },
      );

      if (error) {
        throw new Error(error.message);
      }

      toast({
        title: "OneDrive sync finished",
        description: `${data?.processed?.length ?? 0} document${(data?.processed?.length ?? 0) === 1 ? "" : "s"} processed.`,
      });
      await onSaved();
    } catch (error) {
      toast({
        title: "OneDrive sync failed",
        description: error instanceof Error ? error.message : "Could not run OneDrive sync.",
        variant: "destructive",
      });
    } finally {
      setIsRunningOneDriveSync(false);
    }
  }

  async function runHubSpotImport(runId?: string): Promise<void> {
    setHubSpotImportError(null);
    setHubSpotImportResult(null);
    setIsRunningHubSpotImport(true);
    setHubSpotImportDialogOpen(false);
    try {
      const { data, error } = await supabase.functions.invoke("qrm-hubspot-import", {
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
            ? "HubSpot import failed. Review QRM import logs and retry."
            : "HubSpot import completed with errors. Review QRM import logs for failed rows."
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
              <SheetDescription className="text-xs text-muted-foreground mt-0.5">
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
                integration.status === "replaced"
                  ? "bg-emerald-500/10 border-emerald-400/40"
                  : integration.status === "connected"
                  ? "bg-emerald-500/10 border-emerald-400/40"
                  : integration.status === "error"
                  ? "bg-[#FEF2F2] border-[#FECACA]"
                  : "bg-muted border-border"
              )}
            >
              {integration.status === "replaced" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
              ) : integration.status === "connected" ? (
                <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" aria-hidden="true" />
              ) : integration.status === "error" ? (
                <XCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {integration.status === "replaced"
                    ? `Replaced by ${replacement?.replacementSurface ?? BRAND_NAME}`
                    : integration.status === "connected"
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
                {integration.status === "replaced" && replacement && (
                  <>
                    <p className="text-xs text-muted-foreground mt-1">{replacement.summary}</p>
                    <p className="text-xs text-muted-foreground mt-2">{replacement.detail}</p>
                  </>
                )}
                {integration.status === "pending_credentials" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Add your credentials below to connect. It'll run in demo mode until you do.
                  </p>
                )}
                {isHubSpot && (
                  <div className="mt-3">
                    <Button
                      asChild
                      size="sm"
                      className="bg-qep-orange text-white hover:bg-qep-orange-hover focus-visible:ring-qep-orange"
                    >
                      <a href="/auth/hubspot/connect">
                        {integration.status === "connected" ? "Reconnect HubSpot" : "Connect HubSpot"}
                      </a>
                    </Button>
                  </div>
                )}
                {isOneDrive && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {oneDriveConnectUrl ? (
                      <Button
                        asChild
                        size="sm"
                        className="bg-qep-orange text-white hover:bg-qep-orange-hover focus-visible:ring-qep-orange"
                      >
                        <a href={oneDriveConnectUrl}>
                          {integration.status === "connected" ? "Reconnect OneDrive" : "Connect OneDrive"}
                        </a>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled
                        className="bg-qep-orange text-white"
                      >
                        Connect OneDrive
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-border text-foreground hover:bg-muted focus-visible:ring-qep-orange"
                      onClick={() => void handleRunOneDriveSync()}
                      disabled={isRunningOneDriveSync || !oneDriveSyncStateId}
                    >
                      {isRunningOneDriveSync ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Running sync…
                        </>
                      ) : (
                        "Run sync now"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {isHubSpot && (
            <>
              <Separator className="bg-muted/40" />

              <section>
                <h4 className="text-sm font-semibold text-foreground mb-1">Bulk import</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Import HubSpot companies, contacts, deals, and activities into QRM.
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
                  <div className="mt-3 rounded-lg border border-[#FED7AA] bg-primary/10 p-3">
                    <p className="text-xs font-medium text-primary">
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
                              : "border-[#FED7AA] bg-card",
                          )}
                          onClick={() => setSelectedResumeRunId(run.id)}
                        >
                          <span className="block w-full">
                            <span className="flex items-center justify-between gap-2">
                              <span className={cn("text-xs font-semibold", hubspotRunStatusTone(run.status))}>
                                {hubspotRunStatusLabel(run.status)}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatHubSpotRunTimestamp(run.startedAt)}
                              </span>
                            </span>
                            <span className="mt-1 block text-[11px] text-muted-foreground">
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
                      className="mt-2 w-full border-[#FED7AA] text-primary hover:bg-[#FFEDD5] focus-visible:ring-qep-orange"
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
                    <p className="mt-1 text-xs text-muted-foreground">
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
                            <span className="text-muted-foreground">
                              {formatHubSpotRunTimestamp(run.completedAt ?? run.startedAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            {formatHubSpotRunCount(run)}
                            {run.errorCount > 0
                              ? ` • ${run.errorCount.toLocaleString()} errors`
                              : ""}
                          </p>
                          {run.errorSummary && (
                            <p className="mt-1 text-destructive line-clamp-2">{run.errorSummary}</p>
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
                      <Label htmlFor="hubspot-review-run" className="text-[11px] font-medium text-muted-foreground">
                        Review run
                      </Label>
                      <select
                        id="hubspot-review-run"
                        value={selectedReviewRunId ?? ""}
                        onChange={(event) => setSelectedReviewRunId(event.target.value || null)}
                        className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      Run an import to generate reconciliation data.
                    </p>
                  ) : activeRunErrors.length === 0 ? (
                      <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                        No error rows found for run {activeReconciliationRunId.slice(0, 8)}.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <div className={cn("rounded-lg border p-3", reconciliationTone.cardClassName)}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-xs font-medium text-foreground">Reconciliation status</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Run {activeReconciliationRunId.slice(0, 8)} is the current cutover validation source.
                              </p>
                            </div>
                            <span className={cn("inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold", reconciliationTone.labelClassName)}>
                              {reconciliationTone.label}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <div className="rounded border border-white/70 bg-card px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Error rows</p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {activeRunErrors.length.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded border border-white/70 bg-card px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Top reason</p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {topReasonErrorRows[0] ? formatHubSpotReasonLabel(topReasonErrorRows[0].reasonCode) : "None"}
                              </p>
                            </div>
                            <div className="rounded border border-white/70 bg-card px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Top entity</p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {topEntityErrorRows[0]?.entityType ?? "None"}
                              </p>
                            </div>
                          </div>
                          <p className="mt-3 text-xs text-muted-foreground">{reconciliationTone.nextAction}</p>
                        </div>

                        <p className="text-[11px] text-muted-foreground">
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
                              <span className="text-destructive">{row.count.toLocaleString()}</span>
                            </div>
                          ))}
                          {topReasonErrorRows.slice(0, 4).map((row) => (
                            <div
                              key={`reason-${row.reasonCode}`}
                              className="flex items-center justify-between rounded border border-border px-2 py-1 text-[11px]"
                            >
                              <span className="font-medium text-foreground">{formatHubSpotReasonLabel(row.reasonCode)}</span>
                              <span className="text-destructive">{row.count.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-2">
                          {activeRunErrors.slice(0, 3).map((error) => (
                            <div key={error.id} className="rounded border border-[#FECACA] bg-card px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#BE123C]">
                                  {formatHubSpotReasonLabel(error.reasonCode)}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
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
                    cutoverPacketReady
                      ? "border-emerald-400/40 bg-emerald-500/10"
                      : "border-[#FED7AA] bg-primary/10",
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-medium text-foreground">Cutover summary</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Keep the migration decision in one place before HubSpot becomes source-only.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {hubspotCutoverDirty && (
                        <span className="inline-flex rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                          Unsaved handoff changes
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          cutoverStageTone,
                        )}
                      >
                        {cutoverStageLabel}
                      </span>
                    </div>
                  </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {cutoverChecklist.map((item) => (
                        <div key={item.label} className="rounded border border-white/70 bg-card px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {item.label}
                        </p>
                        <p className={cn("mt-1 text-sm font-semibold", item.tone)}>{item.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 rounded border border-white/70 bg-card px-3 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Recommendation
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopyCutoverPacket()}
                        disabled={isCopyingCutoverPacket}
                        className="border-input bg-card text-muted-foreground hover:bg-muted/30"
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                        {isCopyingCutoverPacket ? "Copying..." : "Copy packet"}
                      </Button>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-foreground">{cutoverRecommendation}</p>
                    <div className="mt-3 rounded border border-border bg-muted/30 px-3 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Final handoff call
                          </p>
                          <p className="mt-1 text-sm font-semibold text-foreground">{cutoverDecisionLabel}</p>
                        </div>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold",
                            effectiveCutoverDecision === "rollback_validation"
                              ? "bg-[#FFE4E6] text-[#BE123C]"
                              : effectiveCutoverDecision === "hold_parallel_run"
                              ? "bg-[#FFEDD5] text-primary"
                              : "bg-[#DCFCE7] text-green-700 dark:text-green-400",
                          )}
                        >
                          {cutoverDecisionLabel}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{cutoverDecisionDescription}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {hubspotCutoverDecisionNote.trim() || "Add the owner-facing handoff note in the details panel before the packet leaves the team."}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowHubspotCutoverDetails((value) => !value)}
                        disabled={isSaving}
                        className="border-input bg-card text-muted-foreground hover:bg-muted/30"
                      >
                        {showHubspotCutoverDetails ? "Hide handoff details" : "Review handoff details"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handleSave({ closeOnSuccess: false })}
                        disabled={isSaving || !hubspotCutoverDirty}
                        className="border-input bg-card text-muted-foreground hover:bg-muted/30"
                      >
                        {isSaving ? "Saving..." : "Save handoff changes"}
                      </Button>
                      {!effectiveDeployGateReady && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleApproveDeployGate}
                          disabled={isSaving || !cutoverPacketReady}
                          className="bg-foreground text-background hover:bg-foreground/90"
                        >
                          Approve deploy gate
                        </Button>
                      )}
                      {cutoverHandoffReady && !hubspotSourceOnlyEnabled && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleEnableSourceOnly}
                          disabled={isSaving}
                          className="bg-qep-orange text-white hover:bg-qep-orange/90"
                        >
                          Mark source-only
                        </Button>
                      )}
                      {hubspotSourceOnlyEnabled && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleReopenParallelRun}
                          disabled={isSaving}
                          className="border-input bg-card text-muted-foreground hover:bg-muted/30"
                        >
                          Reopen parallel run
                        </Button>
                      )}
                    </div>
                    {cutoverMissingItems.length > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Remaining handoff items
                        </p>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          {cutoverMissingItems.map((item) => (
                            <li key={item} className="flex gap-2">
                              <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-green-700 dark:text-green-400">
                        No remaining handoff items are blocking the cutover package.
                      </p>
                    )}
                  </div>

                  {(latestFinishedRun || hubspotCutoverNote.trim().length > 0) && (
                    <div className="mt-3 space-y-2">
                      {latestFinishedRun && (
                        <div className="rounded border border-white/70 bg-card px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Latest finished run
                          </p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {hubspotRunStatusLabel(latestFinishedRun.status)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatHubSpotRunCount(latestFinishedRun)} • {formatHubSpotRunTimestamp(latestFinishedRun.completedAt ?? latestFinishedRun.startedAt)}
                          </p>
                        </div>
                      )}
                      {(effectiveDeployGateReady || hubspotSourceOnlyEnabled) && (
                        <div className="rounded border border-white/70 bg-card px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Handoff status
                          </p>
                          <p className="mt-1 text-sm font-semibold text-foreground">{cutoverStageLabel}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Deploy gate {effectiveDeployGateReady ? "approved" : "not approved"} • HubSpot{" "}
                            {hubspotSourceOnlyEnabled
                              ? `source-only since ${formatHubSpotValidationDate(hubspotSourceOnlyActivatedAt)}`
                              : "still active for operators"}
                          </p>
                        </div>
                      )}
                      {hubspotCutoverNote.trim().length > 0 && (
                        <div className="rounded border border-white/70 bg-card px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Validation note
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">{hubspotCutoverNote.trim()}</p>
                        </div>
                      )}
                      {(hubspotCutoverDecisionNote.trim().length > 0 || effectiveCutoverDecision !== "hold_parallel_run") && (
                        <div className="rounded border border-white/70 bg-card px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Handoff note
                          </p>
                          <p className="mt-1 text-sm font-semibold text-foreground">{cutoverDecisionLabel}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {hubspotCutoverDecisionNote.trim() || "No owner-facing handoff note is recorded yet."}
                          </p>
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
                        ? "bg-emerald-500/10 border-emerald-400/40 text-green-700 dark:text-green-400"
                        : "bg-primary/10 border-[#FED7AA] text-primary"
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

                {showHubspotCutoverDetails && (
                  <div className="mt-3 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-foreground">Handoff details</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Directly edit validation fields when the quick actions above are not enough.
                        </p>
                      </div>
                      {hubspotCutoverDirty && (
                        <span className="inline-flex rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                          Unsaved
                        </span>
                      )}
                    </div>
                    <div className="mt-3 space-y-3">
                    <label className="flex items-center justify-between gap-3 rounded border border-border px-2.5 py-2">
                      <span className="text-xs text-muted-foreground">Parallel run active</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={hubspotParallelRunEnabled}
                        aria-label="Toggle HubSpot parallel run mode"
                        disabled={isSaving}
                        onClick={() => setHubspotParallelRunEnabled((value) => !value)}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
                          isSaving && "cursor-not-allowed opacity-60",
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
                      <span className="text-xs text-muted-foreground">Cutover ready</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={hubspotCutoverReady}
                        aria-label="Toggle HubSpot cutover readiness"
                        disabled={isSaving}
                        onClick={() => setHubspotCutoverReady((value) => !value)}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
                          isSaving && "cursor-not-allowed opacity-60",
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

                    <label className="flex items-center justify-between gap-3 rounded border border-border px-2.5 py-2">
                      <span className="text-xs text-muted-foreground">Deploy gate approved</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={effectiveDeployGateReady}
                        aria-label="Toggle HubSpot deploy gate approval"
                        disabled={isSaving}
                        onClick={() => {
                          if (isSaving) {
                            return;
                          }
                          if (effectiveDeployGateReady && hubspotSourceOnlyEnabled) {
                            toast({
                              title: "Turn off source-only first",
                              description: "HubSpot is already marked source-only. Disable that state before clearing deploy-gate approval.",
                              variant: "destructive",
                            });
                            return;
                          }
                          setHubspotDeployGateReady(!effectiveDeployGateReady);
                        }}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
                          isSaving && "cursor-not-allowed opacity-60",
                          effectiveDeployGateReady ? "bg-qep-orange" : "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none block h-4 w-4 rounded-full bg-card shadow-sm transition-transform duration-200 mt-0.5",
                            effectiveDeployGateReady ? "translate-x-[18px]" : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border border-border px-2.5 py-2">
                      <span className="text-xs text-muted-foreground">HubSpot source-only</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={hubspotSourceOnlyEnabled}
                        aria-label="Toggle HubSpot source-only mode"
                        disabled={isSaving || (!hubspotSourceOnlyEnabled && (!cutoverPacketReady || !effectiveDeployGateReady))}
                        onClick={() => {
                          if (isSaving) {
                            return;
                          }
                          if (!hubspotSourceOnlyEnabled && !cutoverPacketReady) {
                            toast({
                              title: "Finish the cutover packet first",
                              description: "Parallel run, validation, and reconciliation must be complete before HubSpot can move to source-only.",
                              variant: "destructive",
                            });
                            return;
                          }
                          if (!hubspotSourceOnlyEnabled && !effectiveDeployGateReady) {
                            toast({
                              title: "Approve the deploy gate first",
                              description: "Mark the deploy gate approved before switching HubSpot to source-only mode.",
                              variant: "destructive",
                            });
                            return;
                          }
                          setHubspotSourceOnlyEnabled((value) => {
                            const next = !value;
                            if (next && hubspotSourceOnlyActivatedAt.trim().length === 0) {
                              setHubspotSourceOnlyActivatedAt(new Date().toISOString().slice(0, 10));
                            }
                            if (!next) {
                              setHubspotSourceOnlyActivatedAt("");
                            }
                            return next;
                          });
                        }}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange focus-visible:ring-offset-1",
                          (isSaving || (!hubspotSourceOnlyEnabled && (!cutoverPacketReady || !effectiveDeployGateReady))) && "cursor-not-allowed opacity-60",
                          hubspotSourceOnlyEnabled ? "bg-qep-orange" : "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none block h-4 w-4 rounded-full bg-card shadow-sm transition-transform duration-200 mt-0.5",
                            hubspotSourceOnlyEnabled ? "translate-x-[18px]" : "translate-x-0.5",
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
                        disabled={isSaving}
                        className="text-sm focus-visible:ring-qep-orange"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="hubspot-source-only-at" className="text-xs font-medium text-[#374151]">
                        Source-Only Date
                      </Label>
                      <Input
                        id="hubspot-source-only-at"
                        type="date"
                        value={hubspotSourceOnlyActivatedAt}
                        onChange={(event) => setHubspotSourceOnlyActivatedAt(event.target.value)}
                        disabled={isSaving}
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
                        disabled={isSaving}
                        className="text-sm focus-visible:ring-qep-orange"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="hubspot-cutover-decision" className="text-xs font-medium text-[#374151]">
                        Final Handoff Call
                      </Label>
                      <select
                        id="hubspot-cutover-decision"
                        value={effectiveCutoverDecision}
                        onChange={(event) =>
                          setHubspotCutoverDecision(event.target.value as HubSpotCutoverDecision)}
                        disabled={isSaving}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-qep-orange disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="hold_parallel_run" disabled={!allowedCutoverDecisions.includes("hold_parallel_run")}>Hold in parallel run</option>
                        <option value="open_deploy_gate" disabled={!allowedCutoverDecisions.includes("open_deploy_gate")}>Open deploy gate</option>
                        <option value="switch_source_only" disabled={!allowedCutoverDecisions.includes("switch_source_only")}>Switch to source-only</option>
                        <option value="source_only_live" disabled={!allowedCutoverDecisions.includes("source_only_live")}>Confirm source-only handoff</option>
                        <option value="rollback_validation" disabled={!allowedCutoverDecisions.includes("rollback_validation")}>Rollback for more validation</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="hubspot-cutover-decision-note" className="text-xs font-medium text-[#374151]">
                        Owner Handoff Note
                      </Label>
                      <Input
                        id="hubspot-cutover-decision-note"
                        type="text"
                        placeholder="Short board-facing call on what operations should do next"
                        value={hubspotCutoverDecisionNote}
                        onChange={(event) => setHubspotCutoverDecisionNote(event.target.value)}
                        disabled={isSaving}
                        className="text-sm focus-visible:ring-qep-orange"
                      />
                    </div>
                  </div>
                  </div>
                )}
              </section>
            </>
          )}

          <Separator className="bg-muted/40" />

          {/* Section 2: Credential form */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-3">Credentials &amp; configuration</h4>
            <div className="space-y-4">
              {isReplaced ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium text-foreground">Native replacement in effect</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {replacement?.summary}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Credential entry is disabled because this integration is intentionally retired.
                    Historical identifiers and audit rows may remain, but live workflows should stay in{" "}
                    <span className="font-medium text-foreground">{replacement?.replacementSurface ?? BRAND_NAME}</span>.
                  </p>
                </div>
              ) : isOneDrive ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium text-foreground">Microsoft 365 OAuth connection</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    OneDrive is authorized through Microsoft OAuth. Use the connect button above to rotate access, then run a sync when you want to refresh indexed documents.
                  </p>
                  {typeof integration.config?.drive_id === "string" && integration.config.drive_id ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Drive ID: <span className="font-mono">{integration.config.drive_id}</span>
                    </p>
                  ) : null}
                </div>
              ) : isHubSpot ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="hubspot-client-id" className="text-xs font-medium text-[#374151]">
                      HubSpot Client ID
                      <span className="text-muted-foreground ml-1">(optional)</span>
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
                      <span className="text-muted-foreground ml-1">(optional)</span>
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
                      <span className="text-muted-foreground ml-1">(optional)</span>
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
                  <p className="text-xs text-muted-foreground">
                    Stored with AES-256-GCM encryption. Values are only used server-side for OAuth,
                    webhook verification, and token refresh. Leave blank to keep existing credentials.
                  </p>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="credentials" className="text-xs font-medium text-[#374151]">
                    API Key / Token
                    <span className="text-muted-foreground ml-1">(encrypted at rest)</span>
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
                  <p className="text-xs text-muted-foreground">
                    Stored with AES-256-GCM encryption. Never logged or exposed in plaintext.
                  </p>
                </div>
              )}
              {!isOneDrive && (
                <div className="space-y-1.5">
                  <Label htmlFor="endpoint-url" className="text-xs font-medium text-[#374151]">
                    Endpoint URL
                    <span className="text-muted-foreground ml-1">(optional)</span>
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
              )}
            </div>
            {saveError && (
              <p className="text-xs text-[#DC2626] mt-2">{saveError}</p>
            )}
          </section>

          <Separator className="bg-muted/40" />

          {/* Section 3: Connection test */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-3">Connection test</h4>
            {isReplaced ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium text-foreground">Testing disabled</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This integration is intentionally retired. There is no live upstream connection to validate anymore.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
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
                        {isOneDrive ? "Test Microsoft access" : "Test connection"}
                      </>
                    )}
                  </Button>
                  {isOneDrive && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border text-foreground hover:bg-muted focus-visible:ring-qep-orange w-full"
                      onClick={() => void handleRunOneDriveSync()}
                      disabled={isRunningOneDriveSync || !oneDriveSyncStateId}
                    >
                      {isRunningOneDriveSync ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />
                          Running sync…
                        </>
                      ) : (
                        <>
                          <Database className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                          Run sync now
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {testResult !== null && (
                  <div
                    className={cn(
                      "mt-3 rounded-lg border p-3 flex items-start gap-2",
                      testResult.success
                        ? "bg-emerald-500/10 border-emerald-400/40"
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
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {testResult.success
                          ? `Response in ${testResult.latencyMs}ms`
                          : testResult.error}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <Separator className="bg-muted/40" />

          {/* Section 4: Sync scope toggles */}
          {scopes.length > 0 && !isReplaced && (
            <section>
              <h4 className="text-sm font-semibold text-foreground mb-1">Sync scope</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Choose which data types to sync from this integration.
              </p>
              <div className="space-y-3">
                {scopes.map((scope) => (
                  <div key={scope.key} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground leading-none">{scope.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{scope.description}</p>
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

          <Separator className="bg-muted/40" />

          {/* Section 5: Audit / activity log */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-3">
              {isHubSpot ? "Execution history" : "Recent activity"}
            </h4>
            {isHubSpot ? (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  Real import runs plus recorded integration and cutover audit events only. Current handoff state stays in the cutover summary above.
                </p>
                {hubspotHistoryItems.length > 0 ? (
                <div className="space-y-2">
                  {hubspotHistoryItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "rounded-lg border p-3 flex items-start gap-2.5",
                        item.tone === "danger"
                          ? "bg-[#FEF2F2] border-[#FECACA]"
                          : item.tone === "warning"
                          ? "bg-primary/10 border-[#FED7AA]"
                          : item.tone === "success"
                          ? "bg-emerald-500/10 border-emerald-400/40"
                          : "bg-muted border-border",
                      )}
                    >
                      {item.tone === "danger" ? (
                        <XCircle className="w-3.5 h-3.5 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
                      ) : item.tone === "warning" ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-[#D97706] shrink-0 mt-0.5" aria-hidden="true" />
                      ) : item.tone === "success" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-foreground">{item.title}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatPanelTimestamp(item.occurredAt)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 break-words">{item.detail}</p>
                      </div>
                    </div>
                  ))}
                  {isLoadingCredentialAudit && (
                    <p className="text-[11px] text-muted-foreground">Loading credential audit events…</p>
                  )}
                </div>
              ) : isLoadingCredentialAudit ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" aria-hidden="true" />
                  <p className="text-xs">Loading execution history…</p>
                </div>
              ) : credentialAuditError ? (
                <div className="flex items-center gap-2 text-[#DC2626]">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <p className="text-xs">Execution history could not load. {credentialAuditError}</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <p className="text-xs">No execution history yet — imports and audit events will appear here.</p>
                </div>
              )}
              </>
            ) : integration.lastSyncAt ? (
              <div className="space-y-2">
                <div
                  className={cn(
                    "rounded-lg border p-3 flex items-start gap-2.5",
                    integration.lastSyncError
                      ? "bg-[#FEF2F2] border-[#FECACA]"
                      : "bg-emerald-500/10 border-emerald-400/40"
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
                      <span className="text-[10px] text-muted-foreground shrink-0">
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
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <Database className="w-3 h-3 inline mr-1 -mt-px" aria-hidden="true" />
                        {integration.syncRecords.toLocaleString()} records synced
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                <p className="text-xs">No sync history — first sync will run after connecting.</p>
              </div>
            )}
          </section>

          <Separator className="bg-muted/40" />

          {/* Section 6: Fallback / demo mode explanation */}
          <section>
            <h4 className="text-sm font-semibold text-foreground mb-2">Demo mode</h4>
            {isReplaced ? (
              <p className="text-sm text-muted-foreground leading-relaxed">
                This surface is no longer a live external integration. QEP now runs the business flow natively through{" "}
                <strong className="text-foreground">{replacement?.replacementSurface ?? BRAND_NAME}</strong>. Legacy
                records can stay for audit and migration history, but operators should not reconnect or depend on this vendor.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                While disconnected, we use realistic sample data that mirrors what{" "}
                <strong className="text-foreground">{integration.name}</strong> would provide.
                All Deal Genome Engine features remain fully operational. Data source badges
                will show <span className="font-medium text-qep-orange">Demo</span> to distinguish
                live from sample data.
              </p>
            )}
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
            {!isOneDrive && !isReplaced && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-[#FECACA] text-destructive hover:bg-[#FEF2F2] focus-visible:ring-[#DC2626]"
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
              </>
            )}
          </div>
        </div>
      </SheetContent>

      <Dialog open={hubSpotImportDialogOpen} onOpenChange={setHubSpotImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run a new HubSpot import?</DialogTitle>
            <DialogDescription>
              This will import QRM records from HubSpot and may take a few minutes. We update existing records when they match and add new ones.
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
