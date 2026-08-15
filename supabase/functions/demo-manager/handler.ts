/**
 * Demo Manager handler — workspace-bound JWT auth.
 *
 * JWT (rep/admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace cannot retarget scope. Missing active workspace fails
 * closed (403) before any admin writes. Notifications target iron_managers in
 * the caller shop only — never "default" or another workspace.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  createCallerClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

type JsonRecord = Record<string, unknown>;

export interface DemoManagerPostBody {
  deal_id?: unknown;
  deal_name?: unknown;
  equipment_id?: unknown;
  equipment_category?: unknown;
  buying_intent_confirmed?: unknown;
  workspace?: unknown;
  workspace_id?: unknown;
}

export interface DemoManagerPutBody {
  id?: unknown;
  workspace?: unknown;
  workspace_id?: unknown;
  [key: string]: unknown;
}

export type DemoManagerWorkspaceSelection =
  | { ok: true; workspaceId: string; userId: string }
  | { ok: false; status: 401 | 403; message: string };

interface DealRow {
  id: string;
  workspace_id: string;
  stage_id: string;
  crm_deal_stages: { sort_order: number } | { sort_order: number }[] | null;
}

interface DemoRow {
  id: string;
  workspace_id: string;
  deal_id: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrDefault(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getDealStageSortOrder(deal: unknown): number {
  if (!isRecord(deal)) return 0;
  const stage = deal.crm_deal_stages;
  if (Array.isArray(stage)) {
    return numberOrDefault(stage[0]?.sort_order, 0);
  }
  if (!isRecord(stage)) return 0;
  return numberOrDefault(stage.sort_order, 0);
}

export function resolveDemoManagerWorkspace(params: {
  caller: CallerContext;
}): DemoManagerWorkspaceSelection {
  if (!params.caller.userId || !params.caller.role) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  if (
    !["rep", "admin", "manager", "owner"].includes(params.caller.role)
  ) {
    return { ok: false, status: 403, message: "Forbidden" };
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
    userId: params.caller.userId,
  };
}

async function loadDealInWorkspace(
  adminClient: SupabaseClient,
  dealId: string,
  workspaceId: string,
): Promise<DealRow | null> {
  const { data, error } = await adminClient
    .from("crm_deals")
    .select("id, workspace_id, stage_id, crm_deal_stages!inner(sort_order)")
    .eq("id", dealId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return data as DealRow;
}

async function loadDemoInWorkspace(
  adminClient: SupabaseClient,
  demoId: string,
  workspaceId: string,
): Promise<DemoRow | null> {
  const { data, error } = await adminClient
    .from("demos")
    .select("id, workspace_id, deal_id")
    .eq("id", demoId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data) return null;
  return data as DemoRow;
}

export async function notifyIronManagersForDemoApproval(
  adminClient: SupabaseClient,
  params: {
    workspaceId: string;
    dealId: string;
    dealName: string;
    equipmentCategory: string;
    demoId: string;
  },
): Promise<{ managerIds: string[]; notificationCount: number }> {
  const { data: managers, error } = await adminClient
    .from("profiles")
    .select("id")
    .eq("active_workspace_id", params.workspaceId)
    .eq("iron_role", "iron_manager");

  if (error || !managers?.length) {
    return { managerIds: [], notificationCount: 0 };
  }

  const managerIds = managers.map((mgr) => mgr.id as string);

  for (const managerId of managerIds) {
    const { error: insertError } = await adminClient
      .from("crm_in_app_notifications")
      .insert({
        workspace_id: params.workspaceId,
        user_id: managerId,
        kind: "demo_approval",
        title: `Demo Requested: ${params.dealName}`,
        body:
          `${params.equipmentCategory} demo requested. Qualification: all prerequisites met.`,
        deal_id: params.dealId,
        metadata: { demo_id: params.demoId },
      });

    if (insertError) {
      console.error("demo-manager notification insert error:", insertError);
    }
  }

  return { managerIds, notificationCount: managerIds.length };
}

export interface DemoManagerDependencies {
  createAdminClient: typeof createAdminClient;
  createCallerClient: typeof createCallerClient;
  resolveCallerContext: typeof resolveCallerContext;
  notifyIronManagersForDemoApproval: typeof notifyIronManagersForDemoApproval;
}

const defaultDependencies: DemoManagerDependencies = {
  createAdminClient,
  createCallerClient,
  resolveCallerContext,
  notifyIronManagersForDemoApproval,
};

export async function handleDemoManager(
  req: Request,
  overrides: Partial<DemoManagerDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const adminClient = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, adminClient);

    if (caller.isServiceRole) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const workspaceSelection = resolveDemoManagerWorkspace({ caller });
    if (!workspaceSelection.ok) {
      return safeJsonError(
        workspaceSelection.message,
        workspaceSelection.status,
        origin,
      );
    }

    const { workspaceId, userId } = workspaceSelection;
    const authHeader = caller.authHeader;
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = dependencies.createCallerClient(authHeader);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const dealId = url.searchParams.get("deal_id");

      if (!dealId) {
        return safeJsonError("deal_id is required", 400, origin);
      }

      const deal = await loadDealInWorkspace(adminClient, dealId, workspaceId);
      if (!deal) {
        return safeJsonError("Deal not found in your workspace", 403, origin);
      }

      const { data, error } = await supabase
        .from("demos")
        .select("*, demo_inspections(*)")
        .eq("deal_id", dealId)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("demo-manager GET error:", error);
        return safeJsonError("Failed to fetch demos", 500, origin);
      }

      return safeJsonOk({ demos: data }, origin);
    }

    if (req.method === "POST") {
      const body = (await req.json()) as DemoManagerPostBody;

      if (!cleanString(body.deal_id)) {
        return safeJsonError("deal_id is required", 400, origin);
      }

      const dealId = cleanString(body.deal_id)!;
      const deal = await loadDealInWorkspace(adminClient, dealId, workspaceId);
      if (!deal) {
        return safeJsonError("Deal not found in your workspace", 403, origin);
      }

      const prerequisites = {
        needs_assessment_complete: false,
        quote_presented: false,
        buying_intent_confirmed: false,
      };

      const { data: assessment } = await supabase
        .from("needs_assessments")
        .select("fields_populated")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      prerequisites.needs_assessment_complete =
        (assessment?.fields_populated ?? 0) >= 5;

      const sortOrder = getDealStageSortOrder(deal);
      prerequisites.quote_presented = sortOrder >= 8;
      prerequisites.buying_intent_confirmed = body.buying_intent_confirmed === true;

      const missing: string[] = [];
      if (!prerequisites.needs_assessment_complete) {
        missing.push("Needs assessment incomplete (min 5 fields)");
      }
      if (!prerequisites.quote_presented) {
        missing.push("Quote must be presented first (Stage 8+)");
      }
      if (!prerequisites.buying_intent_confirmed) {
        missing.push("Buying intent not confirmed");
      }

      if (missing.length > 0) {
        return safeJsonOk({
          blocked: true,
          missing_prerequisites: missing,
          prerequisites,
        }, origin, 200);
      }

      const equipmentCategory = cleanString(body.equipment_category) ??
        "construction";

      const { data: demo, error: demoError } = await supabase
        .from("demos")
        .insert({
          workspace_id: workspaceId,
          deal_id: dealId,
          equipment_id: cleanString(body.equipment_id),
          needs_assessment_complete: prerequisites.needs_assessment_complete,
          quote_presented: prerequisites.quote_presented,
          buying_intent_confirmed: prerequisites.buying_intent_confirmed,
          equipment_category: equipmentCategory,
          max_hours: equipmentCategory === "forestry" ? 4 : 10,
          requested_by: userId,
        })
        .select()
        .single();

      if (demoError) {
        console.error("demo-manager POST error:", demoError);
        return safeJsonError("Failed to create demo request", 500, origin);
      }

      await dependencies.notifyIronManagersForDemoApproval(adminClient, {
        workspaceId,
        dealId,
        dealName: cleanString(body.deal_name) ?? "Deal",
        equipmentCategory,
        demoId: demo.id as string,
      });

      return safeJsonOk({ demo, prerequisites }, origin, 201);
    }

    if (req.method === "PUT") {
      const body = (await req.json()) as DemoManagerPutBody;
      const demoId = cleanString(body.id);

      if (!demoId) {
        return safeJsonError("id is required for update", 400, origin);
      }

      const existingDemo = await loadDemoInWorkspace(
        adminClient,
        demoId,
        workspaceId,
      );
      if (!existingDemo) {
        return safeJsonError("Demo not found in your workspace", 403, origin);
      }

      const {
        id: _id,
        workspace: _workspace,
        workspace_id: _workspaceId,
        ...updates
      } = body;

      const { data, error } = await supabase
        .from("demos")
        .update(updates)
        .eq("id", demoId)
        .eq("workspace_id", workspaceId)
        .select()
        .single();

      if (error) {
        console.error("demo-manager PUT error:", error);
        if (error.message?.includes("DEMO_GATE")) {
          return safeJsonError(error.message, 400, origin);
        }
        return safeJsonError("Failed to update demo", 500, origin);
      }

      return safeJsonOk({ demo: data }, origin);
    }

    return safeJsonError("Method not allowed", 405, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "demo-manager", req });
    console.error("demo-manager error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
}
