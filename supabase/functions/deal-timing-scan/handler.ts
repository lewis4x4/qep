/**
 * Deal Timing Scan handler — workspace-bound JWT + service-role/cron paths.
 *
 * JWT (manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace / body.workspace_id cannot retarget scope.
 * Missing active workspace fails closed (403). Never falls back to "default".
 *
 * Service role (cron / internal): optional explicit workspace via
 * x-workspace-id header and/or body workspace / workspace_id. When no
 * workspace hint is provided (pg_cron periodic), uses SERVICE_CRON_DEFAULT
 * workspace only for service-role callers — JWT never inherits that default.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { publishFlowEvent } from "../_shared/flow-bus/publish.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

/** Documented service-role-only fallback when pg_cron sends no workspace hint. */
export const SERVICE_CRON_DEFAULT_WORKSPACE = "default";

export interface DealTimingScanBody {
  source?: unknown;
  workspace?: unknown;
  workspace_id?: unknown;
}

export type DealTimingWorkspaceSelection =
  | { ok: true; workspaceId: string; isServiceRole: boolean }
  | { ok: false; status: 401 | 403; message: string };

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveDealTimingWorkspace(params: {
  caller: CallerContext;
  isServiceRole: boolean;
  requestedWorkspaceId: string | null;
}): DealTimingWorkspaceSelection {
  if (!params.isServiceRole) {
    if (!params.caller.userId || !params.caller.role) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
    if (!["manager", "owner"].includes(params.caller.role)) {
      return {
        ok: false,
        status: 403,
        message: "Deal timing requires manager or owner role",
      };
    }
    if (!params.caller.workspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    return {
      ok: true,
      workspaceId: params.caller.workspaceId,
      isServiceRole: false,
    };
  }

  const headerWorkspaceId = cleanString(params.caller.workspaceId);
  const requestedWorkspaceId = cleanString(params.requestedWorkspaceId);
  if (
    headerWorkspaceId && requestedWorkspaceId &&
    headerWorkspaceId !== requestedWorkspaceId
  ) {
    return {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    };
  }

  const workspaceId = headerWorkspaceId ??
    requestedWorkspaceId ??
    SERVICE_CRON_DEFAULT_WORKSPACE;
  return { ok: true, workspaceId, isServiceRole: true };
}

async function readBody(req: Request): Promise<DealTimingScanBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as DealTimingScanBody;
}

interface ImmediateAlertRow {
  id: string;
  title: string;
  description: string | null;
  assigned_rep_id: string | null;
  alert_type: string;
  urgency: string;
  actioned_deal_id: string | null;
  customer_profile_id: string | null;
  recommended_action: string | null;
}

export interface DealTimingScanDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  isServiceRoleCaller: typeof isServiceRoleCaller;
  publishFlowEvent: typeof publishFlowEvent;
}

const defaultDependencies: DealTimingScanDependencies = {
  createAdminClient,
  resolveCallerContext,
  isServiceRoleCaller,
  publishFlowEvent,
};

export async function handleDealTimingScan(
  req: Request,
  overrides: Partial<DealTimingScanDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const isServiceRole = dependencies.isServiceRoleCaller(req);
    const authHeader = req.headers.get("Authorization")?.trim();

    if (!isServiceRole && !authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const admin = dependencies.createAdminClient();
    const caller: CallerContext = isServiceRole
      ? {
        authHeader: authHeader ?? null,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: cleanString(req.headers.get("x-workspace-id")),
      }
      : await dependencies.resolveCallerContext(req, admin);

    const body = await readBody(req);
    const requestedWorkspaceId = cleanString(body.workspace) ??
      cleanString(body.workspace_id);

    const workspaceSelection = resolveDealTimingWorkspace({
      caller,
      isServiceRole,
      requestedWorkspaceId: isServiceRole ? requestedWorkspaceId : null,
    });

    if (!workspaceSelection.ok) {
      return safeJsonError(
        workspaceSelection.message,
        workspaceSelection.status,
        origin,
      );
    }

    const workspaceId = workspaceSelection.workspaceId;

    if (req.method === "GET") {
      const { data, error } = await admin.rpc("get_timing_dashboard", {
        p_workspace_id: workspaceId,
      });

      if (error) {
        console.error("get_timing_dashboard error:", error);
        return safeJsonError("Failed to load timing dashboard", 500, origin);
      }

      return safeJsonOk(data, origin);
    }

    if (req.method === "POST") {
      const { data: alertCount, error } = await admin.rpc(
        "compute_deal_timing_alerts",
        { p_workspace_id: workspaceId },
      );

      if (error) {
        console.error("compute_deal_timing_alerts error:", error);
        return safeJsonError("Timing scan failed", 500, origin);
      }

      const { data: immediateAlerts } = await admin
        .from("deal_timing_alerts")
        .select(
          "id, title, description, assigned_rep_id, alert_type, urgency, actioned_deal_id, customer_profile_id, recommended_action",
        )
        .eq("workspace_id", workspaceId)
        .eq("urgency", "immediate")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);

      let notificationsSent = 0;
      let busPublished = 0;
      let busFailed = 0;

      if (immediateAlerts) {
        const { data: managers } = await admin
          .from("profiles")
          .select("id")
          .eq("iron_role", "iron_manager")
          .eq("active_workspace_id", workspaceId);
        const managerIds = (managers ?? []).map((m) => m.id);

        for (const alert of immediateAlerts as ImmediateAlertRow[]) {
          const recipients = alert.assigned_rep_id
            ? [alert.assigned_rep_id]
            : managerIds;

          for (const uid of recipients) {
            const { error: notifErr } = await admin
              .from("crm_in_app_notifications")
              .insert({
                workspace_id: workspaceId,
                user_id: uid,
                kind: "deal_timing_alert",
                title: alert.title,
                body: alert.description || "Timing alert — action required.",
                metadata: { alert_id: alert.id, urgency: "immediate" },
              });
            if (!notifErr) notificationsSent++;
          }

          try {
            await dependencies.publishFlowEvent(admin, {
              workspaceId,
              eventType: "deal_timing.alert_generated",
              sourceModule: "deal-timing-scan",
              sourceRecordId: alert.id,
              dealId: alert.actioned_deal_id ?? undefined,
              customerId: alert.customer_profile_id ?? undefined,
              suggestedOwner: alert.assigned_rep_id ?? undefined,
              severity: "high",
              commercialRelevance: "high",
              requiredAction: alert.recommended_action ?? alert.title,
              draftMessage: alert.description ?? undefined,
              payload: {
                alert_id: alert.id,
                alert_type: alert.alert_type,
                urgency: alert.urgency,
                title: alert.title,
              },
              idempotencyKey: `deal_timing.alert_generated:${alert.id}`,
            });
            busPublished++;
          } catch (busErr) {
            busFailed++;
            console.error(
              "[deal-timing-scan] flow bus publish failed:",
              busErr instanceof Error ? busErr.message : busErr,
            );
            captureEdgeException(busErr, {
              fn: "deal-timing-scan",
              req,
              extra: { phase: "bus_publish", alert_id: alert.id },
            });
          }
        }
      }

      console.log(
        `[deal-timing-scan] workspace=${workspaceId} alerts=${immediateAlerts?.length ?? 0} ` +
          `notifications_sent=${notificationsSent} bus_published=${busPublished} bus_failed=${busFailed}`,
      );

      return safeJsonOk({
        ok: true,
        workspace_id: workspaceId,
        alerts_generated: alertCount,
        notifications_sent: notificationsSent,
        bus_published: busPublished,
        bus_failed: busFailed,
      }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(err, { fn: "deal-timing-scan", req });
    console.error("deal-timing-scan error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
}
