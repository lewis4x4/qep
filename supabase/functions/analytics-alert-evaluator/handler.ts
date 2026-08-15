/**
 * Analytics alert evaluator — threshold breach detection + auto-resolve.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (owner): always evaluates the caller's active workspace only.
 *   Body/query `workspace` / `workspace_id` is ignored so a forged target
 *   cannot fire or resolve another shop's alerts. Missing active workspace
 *   fails closed (403).
 * - Service role / internal secret (cron): evaluates all workspaces when no
 *   workspace hint is provided. Optional `workspace` / `workspace_id` in JSON
 *   body or `x-workspace-id` header scopes the pass to one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret, x-workspace-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export interface MetricDefRow {
  metric_key: string;
  label: string;
  owner_role: string;
  threshold_config: Record<string, unknown>;
}

export interface SnapshotRow {
  workspace_id: string;
  metric_key: string;
  metric_value: number | null;
  calculated_at: string;
  metadata: Record<string, unknown>;
  refresh_state: string;
}

export type EvaluatorScope =
  | { mode: "workspace"; workspaceId: string }
  | { mode: "all" };

export interface AnalyticsAlertEvaluatorBody {
  workspace?: unknown;
  workspace_id?: unknown;
}

/**
 * Threshold rule evaluator. Returns severity + reason or null (within band).
 */
export function evaluateThreshold(
  value: number | null,
  config: Record<string, unknown>,
): { severity: "warn" | "error" | "critical" | null; reason: string } {
  if (value == null) return { severity: null, reason: "no_value" };

  const cfg = config ?? {};
  if (typeof cfg.critical_above === "number" && value >= cfg.critical_above) {
    return {
      severity: "critical",
      reason: `value ${value} ≥ critical_above ${cfg.critical_above}`,
    };
  }
  if (typeof cfg.warn_above === "number" && value >= cfg.warn_above) {
    return {
      severity: "warn",
      reason: `value ${value} ≥ warn_above ${cfg.warn_above}`,
    };
  }
  if (typeof cfg.critical_below === "number" && value <= cfg.critical_below) {
    return {
      severity: "critical",
      reason: `value ${value} ≤ critical_below ${cfg.critical_below}`,
    };
  }
  if (typeof cfg.warn_below === "number" && value <= cfg.warn_below) {
    return {
      severity: "warn",
      reason: `value ${value} ≤ warn_below ${cfg.warn_below}`,
    };
  }
  if (
    typeof cfg.target_pct_of_quota === "number" &&
    value < cfg.target_pct_of_quota
  ) {
    if (typeof cfg.critical_pct === "number" && value < cfg.critical_pct) {
      return {
        severity: "critical",
        reason: `attainment ${value}% < critical ${cfg.critical_pct}%`,
      };
    }
    if (typeof cfg.warn_pct === "number" && value < cfg.warn_pct) {
      return {
        severity: "warn",
        reason: `attainment ${value}% < warn ${cfg.warn_pct}%`,
      };
    }
  }

  return { severity: null, reason: "within_band" };
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveAlertEvaluatorScope(params: {
  caller: CallerContext;
  isServiceRole: boolean;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; scope: EvaluatorScope }
  | { ok: false; status: 403; message: string } {
  if (!params.isServiceRole) {
    if (!params.caller.workspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    return {
      ok: true,
      scope: { mode: "workspace", workspaceId: params.caller.workspaceId },
    };
  }

  const headerWorkspace = cleanString(params.caller.workspaceId);
  const bodyWorkspace = cleanString(params.requestedWorkspaceId);
  if (headerWorkspace && bodyWorkspace && headerWorkspace !== bodyWorkspace) {
    return {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    };
  }

  const workspaceId = headerWorkspace ?? bodyWorkspace;
  if (workspaceId) {
    return { ok: true, scope: { mode: "workspace", workspaceId } };
  }

  return { ok: true, scope: { mode: "all" } };
}

function applyWorkspaceEq<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  scope: EvaluatorScope,
  column = "workspace_id",
): T {
  if (scope.mode === "workspace") {
    return query.eq(column, scope.workspaceId);
  }
  return query;
}

async function readBody(req: Request): Promise<AnalyticsAlertEvaluatorBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as AnalyticsAlertEvaluatorBody;
}

export interface AnalyticsAlertEvaluatorDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  isServiceRoleCaller: typeof isServiceRoleCaller;
}

const defaultDependencies: AnalyticsAlertEvaluatorDependencies = {
  createAdminClient,
  resolveCallerContext,
  isServiceRoleCaller,
};

export async function handleAnalyticsAlertEvaluator(
  req: Request,
  overrides: Partial<AnalyticsAlertEvaluatorDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const admin = dependencies.createAdminClient();
  const isServiceRole = dependencies.isServiceRoleCaller(req);

  let caller: CallerContext = {
    authHeader: null,
    userId: null,
    role: null,
    isServiceRole: true,
    workspaceId: null,
  };

  if (!isServiceRole) {
    caller = await dependencies.resolveCallerContext(req, admin);
    if (!caller.userId || !caller.role) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }
    if (caller.role !== "owner") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }
  } else {
    caller = await dependencies.resolveCallerContext(req, admin);
  }

  const startedAt = new Date();
  const fired: { metric_key: string; severity: string; alert_id?: string }[] = [];
  const resolved: string[] = [];

  try {
    const body = await readBody(req);
    const requestedWorkspaceId = isServiceRole
      ? (cleanString(body.workspace) ?? cleanString(body.workspace_id))
      : null;

    const scopeSelection = resolveAlertEvaluatorScope({
      caller,
      isServiceRole,
      requestedWorkspaceId,
    });
    if (!scopeSelection.ok) {
      return new Response(JSON.stringify({ error: scopeSelection.message }), {
        status: scopeSelection.status,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }
    const scope = scopeSelection.scope;

    const { data: defs, error: defsErr } = await admin
      .from("analytics_metric_definitions")
      .select("metric_key, label, owner_role, threshold_config")
      .eq("enabled", true);
    if (defsErr) throw new Error(defsErr.message);
    const definitions = (defs ?? []) as MetricDefRow[];
    if (definitions.length === 0) {
      return new Response(JSON.stringify({ ok: true, fired: [], resolved: [] }), {
        status: 200,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    const metricKeys = definitions.map((d) => d.metric_key);
    let snapshotsQuery = admin
      .from("analytics_kpi_snapshots")
      .select("workspace_id, metric_key, metric_value, calculated_at, metadata, refresh_state")
      .in("metric_key", metricKeys)
      .in("refresh_state", ["fresh", "partial"])
      .order("calculated_at", { ascending: false });
    snapshotsQuery = applyWorkspaceEq(snapshotsQuery, scope);

    const { data: snapshots, error: snapErr } = await snapshotsQuery;
    if (snapErr) throw new Error(snapErr.message);

    const latest = new Map<string, SnapshotRow>();
    for (const s of (snapshots ?? []) as SnapshotRow[]) {
      const k = `${s.workspace_id}::${s.metric_key}`;
      if (!latest.has(k)) latest.set(k, s);
    }

    const defByKey = new Map(definitions.map((d) => [d.metric_key, d]));

    for (const snapshot of latest.values()) {
      const def = defByKey.get(snapshot.metric_key);
      if (!def) continue;

      const verdict = evaluateThreshold(
        snapshot.metric_value,
        def.threshold_config ?? {},
      );
      if (!verdict.severity) continue;

      const dedupeKey = `${snapshot.workspace_id}::${snapshot.metric_key}::threshold`;
      const title =
        `${def.label} ${verdict.severity === "critical" ? "CRITICAL" : "WARNING"}`;
      const description = `${verdict.reason}. Calculated ${snapshot.calculated_at}.`;

      try {
        const { data: alertId, error: rpcErr } = await admin.rpc(
          "enqueue_analytics_alert",
          {
            p_workspace_id: snapshot.workspace_id,
            p_alert_type: "threshold_breach",
            p_metric_key: snapshot.metric_key,
            p_severity: verdict.severity,
            p_title: title,
            p_description: description,
            p_role_target: def.owner_role,
            p_dedupe_key: dedupeKey,
            p_metadata: {
              snapshot_calculated_at: snapshot.calculated_at,
              snapshot_metadata: snapshot.metadata,
              threshold_config: def.threshold_config,
            },
          },
        );
        if (rpcErr) throw new Error(rpcErr.message);

        fired.push({
          metric_key: snapshot.metric_key,
          severity: verdict.severity,
          alert_id: alertId as string | undefined,
        });
      } catch (err) {
        console.warn(
          `[alert-evaluator] failed for ${snapshot.metric_key}:`,
          (err as Error).message,
        );
      }
    }

    let openAlertsQuery = admin
      .from("analytics_alerts")
      .select("id, workspace_id, metric_key")
      .in("status", ["new", "acknowledged", "in_progress"]);
    openAlertsQuery = applyWorkspaceEq(openAlertsQuery, scope);

    const { data: openAlerts } = await openAlertsQuery;

    for (const alert of (openAlerts ?? []) as {
      id: string;
      workspace_id: string;
      metric_key: string;
    }[]) {
      const def = defByKey.get(alert.metric_key);
      if (!def) continue;
      const snapshot = latest.get(`${alert.workspace_id}::${alert.metric_key}`);
      if (!snapshot) continue;
      const verdict = evaluateThreshold(
        snapshot.metric_value,
        def.threshold_config ?? {},
      );
      if (verdict.severity == null) {
        let updateQuery = admin
          .from("analytics_alerts")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
            metadata: {
              auto_resolved: true,
              resolved_value: snapshot.metric_value,
            },
          })
          .eq("id", alert.id);
        updateQuery = applyWorkspaceEq(updateQuery, scope);
        await updateQuery;
        resolved.push(alert.id);
      }
    }

    const finishedAt = new Date();
    try {
      await admin.from("service_cron_runs").insert({
        workspace_id: scope.mode === "workspace" ? scope.workspaceId : "default",
        job_name: "analytics-alert-evaluator",
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        ok: true,
        metadata: { fired: fired.length, resolved: resolved.length },
      });
    } catch { /* swallow */ }

    return new Response(JSON.stringify({
      ok: true,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      fired,
      resolved,
      scope: scope.mode === "workspace"
        ? { mode: "workspace", workspace_id: scope.workspaceId }
        : { mode: "all" },
    }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }
    captureEdgeException(err, { fn: "analytics-alert-evaluator", req });
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
}
