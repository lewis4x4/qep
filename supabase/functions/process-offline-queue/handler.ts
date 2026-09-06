/**
 * Process Offline Queue — Sales Companion handler
 *
 * Accepts queued actions captured while the rep was offline and applies them
 * in causal order with workspace + ownership enforcement.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { safeCorsHeaders as corsHeaders, optionsResponse } from "../_shared/safe-cors.ts";
import { resolveProfileActiveWorkspaceId } from "../_shared/workspace.ts";

export type ActionType =
  | "log_visit"
  | "advance_stage"
  | "create_note"
  | "schedule_followup";

export interface QueuedAction {
  user_id?: string;
  workspace_id?: string;
  id: string;
  action_type: ActionType;
  payload: Record<string, unknown>;
  queued_at: string;
}

export interface ActionResult {
  id: string;
  status: "synced" | "failed";
  error?: string;
}

interface OwnedDealRow {
  id: string;
  company_id: string | null;
  stage_id?: string | null;
}

// Process actions in causal order: visits before stage advances
const ACTION_PRIORITY: Record<ActionType, number> = {
  log_visit: 1,
  create_note: 2,
  schedule_followup: 3,
  advance_stage: 4,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProcessOfflineQueueDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  resolveProfileActiveWorkspaceId: typeof resolveProfileActiveWorkspaceId;
}

const defaultDependencies: ProcessOfflineQueueDependencies = {
  createAdminClient,
  resolveCallerContext,
  resolveProfileActiveWorkspaceId,
};

export async function processOfflineQueueAction(db: SupabaseClient, userId: string, workspaceId: string, action: QueuedAction): Promise<ActionResult> {
  if ((action.user_id && action.user_id !== userId) || (action.workspace_id && action.workspace_id !== workspaceId)) {
    return { id: action.id, status: "failed", error: "Captured operator or workspace does not match the current session" };
  }
  try {
    const { data, error } = await db.rpc("apply_sales_offline_action", {
      p_workspace_id: workspaceId, p_user_id: userId, p_action_id: action.id,
      p_action_type: action.action_type, p_payload: action.payload, p_queued_at: action.queued_at,
    });
    if (error) return { id: action.id, status: "failed", error: error.message };
    if (!data || data.id !== action.id || data.status !== "synced") return { id: action.id, status: "failed", error: "Offline action receipt not confirmed" };
    return { id: action.id, status: "synced" };
  } catch (error) {
    return { id: action.id, status: "failed", error: error instanceof Error ? error.message : "Offline action failed" };
  }
}

export async function handleProcessOfflineQueue(
  req: Request,
  overrides: Partial<ProcessOfflineQueueDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);

  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const adminClient = dependencies.createAdminClient();
  const caller = await dependencies.resolveCallerContext(req, adminClient);

  if (!caller.userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => null)) as {
    actions: QueuedAction[];
  } | null;

  if (!body?.actions || !Array.isArray(body.actions)) {
    return new Response(
      JSON.stringify({ error: "Request body must have actions array" }),
      { status: 400, headers: { ...ch, "Content-Type": "application/json" } },
    );
  }

  if (body.actions.length > 50) {
    return new Response(
      JSON.stringify({ error: "Too many actions. Maximum 50 per batch." }),
      { status: 400, headers: { ...ch, "Content-Type": "application/json" } },
    );
  }

  for (const action of body.actions) {
    if (!action.id || typeof action.id !== "string" || !UUID_RE.test(action.id)) {
      return new Response(
        JSON.stringify({ error: `Invalid action id: ${action.id ?? "(missing)"}` }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } },
      );
    }
  }

  let workspaceId: string;
  try {
    workspaceId = await dependencies.resolveProfileActiveWorkspaceId(
      adminClient,
      caller.userId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "workspace resolution failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const sorted = [...body.actions].sort((a, b) => Date.parse(a.queued_at) - Date.parse(b.queued_at));

  const results: ActionResult[] = [];

  for (const action of sorted) {
    const result = await processOfflineQueueAction(
      adminClient,
      caller.userId,
      workspaceId,
      action,
    );
    results.push(result);

  }

  const synced = results.filter((r) => r.status === "synced").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return new Response(
    JSON.stringify({ results, total: results.length, synced, failed }),
    { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
  );
}
