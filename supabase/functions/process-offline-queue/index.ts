/**
 * Process Offline Queue — Sales Companion
 *
 * Accepts an array of queued actions captured while the rep was offline.
 * Processes them in causal order, returns per-action success/failure.
 */
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { safeCorsHeaders as corsHeaders, optionsResponse } from "../_shared/safe-cors.ts";

type ActionType = "log_visit" | "advance_stage" | "create_note" | "schedule_followup";

interface QueuedAction {
  id: string;
  action_type: ActionType;
  payload: Record<string, unknown>;
  queued_at: string;
}

interface ActionResult {
  id: string;
  status: "synced" | "failed";
  error?: string;
}

// Process actions in causal order: visits before stage advances
const ACTION_PRIORITY: Record<ActionType, number> = {
  log_visit: 1,
  create_note: 2,
  schedule_followup: 3,
  advance_stage: 4,
};

async function processAction(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  action: QueuedAction,
): Promise<ActionResult> {
  const { id, action_type, payload, queued_at } = action;

  // Validate timestamp is in the past
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

      // Verify company belongs to rep
      const { data: deal } = await db
        .from("crm_deals")
        .select("id")
        .eq("company_id", company_id)
        .eq("assigned_rep_id", userId)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();

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
        workspace_id: "default",
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

      // Verify deal belongs to rep
      const { data: existingDeal } = await db
        .from("crm_deals")
        .select("id, stage_id")
        .eq("id", deal_id)
        .eq("assigned_rep_id", userId)
        .is("deleted_at", null)
        .maybeSingle();

      if (!existingDeal) {
        return { id, status: "failed", error: "deal not found or not yours" };
      }

      // If stage already changed (conflict), skip
      if ((existingDeal as Record<string, unknown>).stage_id === new_stage_id) {
        return { id, status: "synced" }; // Already at target stage
      }

      const { error } = await db
        .from("crm_deals")
        .update({ stage_id: new_stage_id, updated_at: new Date().toISOString() })
        .eq("id", deal_id)
        .eq("assigned_rep_id", userId);

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

      const { error } = await db.from("crm_activities").insert({
        workspace_id: "default",
        activity_type: "note",
        body: text,
        occurred_at: queued_at,
        company_id: company_id ?? null,
        deal_id: deal_id ?? null,
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

      const { error } = await db
        .from("crm_deals")
        .update({
          next_follow_up_at: follow_up_date,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deal_id)
        .eq("assigned_rep_id", userId);

      if (error) return { id, status: "failed", error: error.message };

      // Also log a note about the scheduled follow-up
      if (note) {
        await db.from("crm_activities").insert({
          workspace_id: "default",
          activity_type: "note",
          body: `Follow-up scheduled for ${follow_up_date}: ${note}`,
          occurred_at: queued_at,
          deal_id,
          created_by: userId,
          metadata: { source: "sales_companion_offline", type: "followup_scheduled" },
        });
      }

      return { id, status: "synced" };
    }

    default:
      return { id, status: "failed", error: `unknown action_type: ${action_type}` };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);
  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const adminClient = createAdminClient();
  const caller = await resolveCallerContext(req, adminClient);

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

  // Rate limit: max 50 actions per batch to prevent abuse
  if (body.actions.length > 50) {
    return new Response(
      JSON.stringify({ error: "Too many actions. Maximum 50 per batch." }),
      { status: 400, headers: { ...ch, "Content-Type": "application/json" } },
    );
  }

  // Validate UUID format on action IDs
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const action of body.actions) {
    if (!action.id || typeof action.id !== "string" || !UUID_RE.test(action.id)) {
      return new Response(
        JSON.stringify({ error: `Invalid action id: ${action.id ?? "(missing)"}` }),
        { status: 400, headers: { ...ch, "Content-Type": "application/json" } },
      );
    }
  }

  // Sort by causal order
  const sorted = [...body.actions].sort(
    (a, b) =>
      (ACTION_PRIORITY[a.action_type] ?? 99) -
      (ACTION_PRIORITY[b.action_type] ?? 99),
  );

  const results: ActionResult[] = [];

  for (const action of sorted) {
    const result = await processAction(adminClient, caller.userId, action);
    results.push(result);

    // Also update the server-side sync queue if it exists
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
});
