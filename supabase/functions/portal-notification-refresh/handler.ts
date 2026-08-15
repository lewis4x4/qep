/**
 * Portal notification refresh — workspace-bound JWT + service-role/cron paths.
 *
 * JWT (manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace / body.workspace_id cannot retarget scope.
 * Missing active workspace fails closed (403). Never falls back to "default".
 *
 * Service role (cron / internal): scans all workspaces when no workspace hint
 * is provided. Optional `workspace` / `workspace_id` in JSON body or
 * `x-workspace-id` header scopes the pass to one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { insertPortalCustomerNotification } from "../_shared/portal-customer-notify.ts";
import {
  buildMaintenanceDueNotification,
  buildMatchingEquipmentNotifications,
} from "../_shared/portal-notification-refresh.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

export interface PortalNotificationRefreshBody {
  workspace?: unknown;
  workspace_id?: unknown;
}

export type PortalNotificationRefreshScope =
  | { mode: "workspace"; workspaceId: string }
  | { mode: "all" };

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolvePortalNotificationRefreshScope(params: {
  caller: CallerContext;
  isServiceRole: boolean;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; scope: PortalNotificationRefreshScope }
  | { ok: false; status: 401 | 403; message: string } {
  if (!params.isServiceRole) {
    if (!params.caller.userId || !params.caller.role) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
    if (!["manager", "owner"].includes(params.caller.role)) {
      return {
        ok: false,
        status: 403,
        message: "Portal notification refresh requires manager or owner role",
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
  scope: PortalNotificationRefreshScope,
  column = "workspace_id",
): T {
  if (scope.mode === "workspace") {
    return query.eq(column, scope.workspaceId);
  }
  return query;
}

async function readBody(req: Request): Promise<PortalNotificationRefreshBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as PortalNotificationRefreshBody;
}

export interface PortalNotificationRefreshDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  isServiceRoleCaller: typeof isServiceRoleCaller;
  insertPortalCustomerNotification: typeof insertPortalCustomerNotification;
}

const defaultDependencies: PortalNotificationRefreshDependencies = {
  createAdminClient,
  resolveCallerContext,
  isServiceRoleCaller,
  insertPortalCustomerNotification,
};

export async function handlePortalNotificationRefresh(
  req: Request,
  overrides: Partial<PortalNotificationRefreshDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (req.method !== "POST") {
      return safeJsonError("Method not allowed", 405, origin);
    }

    const isServiceRole = dependencies.isServiceRoleCaller(req);
    const authHeader = req.headers.get("Authorization")?.trim() ?? null;
    if (!isServiceRole && !authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const admin = dependencies.createAdminClient();
    const caller: CallerContext = isServiceRole
      ? {
        authHeader,
        userId: null,
        role: null,
        isServiceRole: true,
        workspaceId: cleanString(req.headers.get("x-workspace-id")),
      }
      : await dependencies.resolveCallerContext(req, admin);

    const body = await readBody(req);
    const requestedWorkspaceId = cleanString(body.workspace) ??
      cleanString(body.workspace_id);

    const scopeSelection = resolvePortalNotificationRefreshScope({
      caller,
      isServiceRole,
      requestedWorkspaceId: isServiceRole ? requestedWorkspaceId : null,
    });

    if (!scopeSelection.ok) {
      return safeJsonError(
        scopeSelection.message,
        scopeSelection.status,
        origin,
      );
    }

    const scope = scopeSelection.scope;
    const insertWorkspaceId = scope.mode === "workspace" ? scope.workspaceId : null;

    const today = new Date();
    const dueWindow = new Date(today);
    dueWindow.setDate(dueWindow.getDate() + 14);
    const todayIso = today.toISOString().slice(0, 10);
    const dueIso = dueWindow.toISOString().slice(0, 10);
    const newEquipmentSince = new Date(Date.now() - 24 * 3_600_000).toISOString();

    let fleetQuery = admin
      .from("customer_fleet")
      .select("id, workspace_id, portal_customer_id, make, model, next_service_due")
      .eq("is_active", true);
    fleetQuery = applyWorkspaceEq(fleetQuery, scope);

    const { data: fleetRows, error: fleetErr } = await fleetQuery;

    if (fleetErr) {
      return safeJsonError("Failed to load customer fleet", 500, origin);
    }

    const fleet = ((fleetRows ?? []) as Array<Record<string, unknown>>)
      .filter((row) => typeof row.portal_customer_id === "string")
      .map((row) => ({
        id: String(row.id),
        workspace_id: insertWorkspaceId ?? String(row.workspace_id ?? "default"),
        portal_customer_id: String(row.portal_customer_id),
        make: String(row.make ?? ""),
        model: String(row.model ?? ""),
        next_service_due: typeof row.next_service_due === "string"
          ? row.next_service_due
          : null,
      }));

    let maintenanceCount = 0;
    for (const fleetRow of fleet) {
      if (!fleetRow.next_service_due) continue;
      if (fleetRow.next_service_due < todayIso || fleetRow.next_service_due > dueIso) {
        continue;
      }
      const notification = buildMaintenanceDueNotification(fleetRow);
      if (!notification) continue;
      if (insertWorkspaceId) {
        notification.workspace_id = insertWorkspaceId;
      }
      const result = await dependencies.insertPortalCustomerNotification(
        admin,
        notification,
      );
      if (result === "inserted") maintenanceCount++;
    }

    let equipmentQuery = admin
      .from("crm_equipment")
      .select(
        "id, workspace_id, make, model, year, vin_pin, availability, ownership, updated_at, created_at, deleted_at",
      )
      .eq("availability", "available")
      .neq("ownership", "customer_owned")
      .is("deleted_at", null)
      .or(`updated_at.gte.${newEquipmentSince},created_at.gte.${newEquipmentSince}`);
    equipmentQuery = applyWorkspaceEq(equipmentQuery, scope);

    const { data: equipmentRows, error: equipmentErr } = await equipmentQuery;

    if (equipmentErr) {
      return safeJsonError("Failed to load new inventory", 500, origin);
    }

    const matchingNotifications = buildMatchingEquipmentNotifications({
      fleet,
      equipment: ((equipmentRows ?? []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id),
          workspace_id: insertWorkspaceId ?? String(row.workspace_id ?? "default"),
          make: typeof row.make === "string" ? row.make : null,
          model: typeof row.model === "string" ? row.model : null,
          year: typeof row.year === "number" ? row.year : null,
          serial_number: typeof row.vin_pin === "string" ? row.vin_pin : null,
        }),
      ),
    });

    let matchingCount = 0;
    for (const notification of matchingNotifications) {
      if (insertWorkspaceId) {
        notification.workspace_id = insertWorkspaceId;
      }
      const result = await dependencies.insertPortalCustomerNotification(
        admin,
        notification,
      );
      if (result === "inserted") matchingCount++;
    }

    return safeJsonOk({
      ok: true,
      scope: scope.mode === "workspace"
        ? { mode: "workspace", workspace_id: scope.workspaceId }
        : { mode: "all" },
      maintenance_due_inserted: maintenanceCount,
      matching_equipment_inserted: matchingCount,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "portal-notification-refresh", req });
    console.error("portal-notification-refresh error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
}
