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

async function findOwnedDeal(
  db: SupabaseClient,
  params: {
    userId: string;
    workspaceId: string;
    dealId?: string;
    companyId?: string;
  },
): Promise<OwnedDealRow | null> {
  if (params.dealId) {
    let query = db
      .from("crm_deals")
      .select("id, company_id, stage_id")
      .eq("id", params.dealId)
      .eq("assigned_rep_id", params.userId)
      .eq("workspace_id", params.workspaceId)
      .is("deleted_at", null);

    if (params.companyId) {
      query = query.eq("company_id", params.companyId);
    }

    const { data } = await query.maybeSingle();
    return (data as OwnedDealRow | null) ?? null;
  }

  if (params.companyId) {
    const { data } = await db
      .from("crm_deals")
      .select("id, company_id, stage_id")
      .eq("company_id", params.companyId)
      .eq("assigned_rep_id", params.userId)
      .eq("workspace_id", params.workspaceId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    return (data as OwnedDealRow | null) ?? null;
  }

  return null;
}

export async function processOfflineQueueAction(
  db: SupabaseClient,
  userId: string,
  workspaceId: string,
  action: QueuedAction,
): Promise<ActionResult> {
  const { id, action_type, payload, queued_at } = action;

  if (new Date(queued_at) > new Date()) {
    return { id, status: "failed", error: "queued_at must be in the past" };
  }

  switch (action_type) {
    case "log_visit": {
      const {
        company_id,
        outcome,
        notes,
        next_action,
      } = payload as {
        company_id: string;
        outcome: string;
        notes?: string;
        next_action?: string;
      };

      if (!company_id || !outcome) {
        return { id, status: "failed", error: "company_id and outcome required" };
      }

      const deal = await findOwnedDeal(db, {
        userId,
        workspaceId,
        companyId: company_id,
      });

      if (!deal) {
        return { id, status: "failed", error: "no deal found for this company" };
      }

      const body = [
        `Visit outcome: ${outcome}`,
        notes ? `Notes: ${notes}` : null,
        next_action ? `Next action: ${next_action}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const { error } = await db.from("crm_activities").insert({
        workspace_id: workspaceId,
        activity_type: "meeting",
        body,
        occurred_at: queued_at,
        company_id,
        deal_id: deal.id,
        created_by: userId,
        metadata: { source: "sales_companion_offline", outcome, next_action },
      });

      if (error) return { id, status: "failed", error: error.message };
      return { id, status: "synced" };
    }

    case "advance_stage": {
      const { deal_id, new_stage_id } = payload as {
        deal_id: string;
        new_stage_id: string;
      };

      if (!deal_id || !new_stage_id) {
        return { id, status: "failed", error: "deal_id and new_stage_id required" };
      }

      const existingDeal = await findOwnedDeal(db, {
        userId,
        workspaceId,
        dealId: deal_id,
      });

      if (!existingDeal) {
        return { id, status: "failed", error: "deal not found or not yours" };
      }

      if (existingDeal.stage_id === new_stage_id) {
        return { id, status: "synced" };
      }

      const { error } = await db
        .from("crm_deals")
        .update({ stage_id: new_stage_id, updated_at: new Date().toISOString() })
        .eq("id", deal_id)
        .eq("assigned_rep_id", userId)
        .eq("workspace_id", workspaceId);

      if (error) return { id, status: "failed", error: error.message };
      return { id, status: "synced" };
    }

    case "create_note": {
      const { company_id, deal_id, text } = payload as {
        company_id?: string;
        deal_id?: string;
        text: string;
      };

      if (!text) {
        return { id, status: "failed", error: "text required" };
      }

      let resolvedDealId: string | null = deal_id ?? null;
      let resolvedCompanyId: string | null = company_id ?? null;

      if (deal_id || company_id) {
        const ownedDeal = await findOwnedDeal(db, {
          userId,
          workspaceId,
          dealId: deal_id,
          companyId: company_id,
        });

        if (!ownedDeal) {
          return {
            id,
            status: "failed",
            error: "deal or company not found or not yours",
          };
        }

        if (deal_id) {
          resolvedDealId = ownedDeal.id;
          resolvedCompanyId = null;
        } else {
          resolvedDealId = null;
          resolvedCompanyId = company_id ?? null;
        }
      }

      const { error } = await db.from("crm_activities").insert({
        workspace_id: workspaceId,
        activity_type: "note",
        body: text,
        occurred_at: queued_at,
        company_id: resolvedCompanyId,
        deal_id: resolvedDealId,
        created_by: userId,
        metadata: { source: "sales_companion_offline" },
      });

      if (error) return { id, status: "failed", error: error.message };
      return { id, status: "synced" };
    }

    case "schedule_followup": {
      const { deal_id, follow_up_date, note } = payload as {
        deal_id: string;
        follow_up_date: string;
        note?: string;
      };

      if (!deal_id || !follow_up_date) {
        return { id, status: "failed", error: "deal_id and follow_up_date required" };
      }

      const ownedDeal = await findOwnedDeal(db, {
        userId,
        workspaceId,
        dealId: deal_id,
      });

      if (!ownedDeal) {
        return { id, status: "failed", error: "deal not found or not yours" };
      }

      const { error } = await db
        .from("crm_deals")
        .update({
          next_follow_up_at: follow_up_date,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deal_id)
        .eq("assigned_rep_id", userId)
        .eq("workspace_id", workspaceId);

      if (error) return { id, status: "failed", error: error.message };

      if (note) {
        const { error: noteError } = await db.from("crm_activities").insert({
          workspace_id: workspaceId,
          activity_type: "note",
          body: `Follow-up scheduled for ${follow_up_date}: ${note}`,
          occurred_at: queued_at,
          deal_id,
          created_by: userId,
          metadata: { source: "sales_companion_offline", type: "followup_scheduled" },
        });

        if (noteError) {
          return { id, status: "failed", error: noteError.message };
        }
      }

      return { id, status: "synced" };
    }

    default:
      return { id, status: "failed", error: `unknown action_type: ${action_type}` };
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

  const sorted = [...body.actions].sort(
    (a, b) =>
      (ACTION_PRIORITY[a.action_type] ?? 99) -
      (ACTION_PRIORITY[b.action_type] ?? 99),
  );

  const results: ActionResult[] = [];

  for (const action of sorted) {
    const result = await processOfflineQueueAction(
      adminClient,
      caller.userId,
      workspaceId,
      action,
    );
    results.push(result);

    if (result.status === "synced") {
      await adminClient
        .from("offline_sync_queue")
        .update({
          sync_status: "synced",
          synced_at: new Date().toISOString(),
        })
        .eq("id", action.id)
        .eq("user_id", caller.userId);
    } else {
      await adminClient
        .from("offline_sync_queue")
        .update({
          sync_status: "failed",
          error_message: result.error ?? "unknown error",
        })
        .eq("id", action.id)
        .eq("user_id", caller.userId);
    }
  }

  const synced = results.filter((r) => r.status === "synced").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return new Response(
    JSON.stringify({ results, total: results.length, synced, failed }),
    { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
  );
}
