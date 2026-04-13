// ============================================================
// Edge Function: process-parts-request
// Purpose: Manages parts request lifecycle — create, assign,
// update status, add notes, complete, cancel. Validates state
// transitions and logs all activity.
// ============================================================

import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

// ── Types ───────────────────────────────────────────────────

type Action =
  | "create"
  | "assign"
  | "update_status"
  | "add_note"
  | "add_item"
  | "remove_item"
  | "complete"
  | "cancel";

interface RequestBody {
  action: Action;
  request_id?: string;
  // create fields
  request_source?: string;
  priority?: string;
  machine_profile_id?: string;
  machine_description?: string;
  customer_name?: string;
  bay_number?: string;
  work_order_number?: string;
  items?: Array<{
    part_number: string;
    description?: string;
    quantity: number;
    notes?: string;
  }>;
  notes?: string;
  // assign fields
  assign_to?: string;
  // update_status fields
  new_status?: string;
  // add_item fields
  item?: {
    part_number: string;
    description?: string;
    quantity: number;
    notes?: string;
  };
  // remove_item fields
  item_index?: number;
}

// ── Valid State Transitions ─────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  requested: ["acknowledged", "locating", "pulled", "ready", "cancelled"],
  acknowledged: ["locating", "pulled", "ready", "cancelled"],
  locating: ["pulled", "ready", "backordered", "cancelled"],
  pulled: ["ready", "cancelled"],
  ready: ["fulfilled", "cancelled"],
  backordered: ["locating", "pulled", "ready", "cancelled"],
  // Terminal states — no transitions out
  fulfilled: [],
  cancelled: [],
};

// ── Activity Logger ─────────────────────────────────────────

async function logActivity(
  supabase: any,
  opts: {
    workspaceId: string;
    requestId: string;
    userId: string;
    action: string;
    fromValue?: string | null;
    toValue?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from("parts_request_activity").insert({
      workspace_id: opts.workspaceId,
      request_id: opts.requestId,
      user_id: opts.userId,
      action: opts.action,
      from_value: opts.fromValue ?? null,
      to_value: opts.toValue ?? null,
      notes: opts.notes ?? null,
      metadata: opts.metadata ?? null,
    });
  } catch (e) {
    console.warn("logActivity failed (non-blocking):", e);
  }
}

// ── Fetch Request Helper ────────────────────────────────────

async function fetchRequest(supabase: any, requestId: string) {
  const { data, error } = await supabase
    .from("parts_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (error || !data) return null;
  return data;
}

// ── Main Handler ────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST")
    return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(
    req.headers.get("Authorization"),
    origin,
  );
  if (!auth.ok) return auth.response;

  const { supabase, userId } = auth;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }

  const { action } = body;
  if (!action) return safeJsonError("action is required", 400, origin);

  // ── CREATE ──────────────────────────────────────────────

  if (action === "create") {
    const { request_source, priority, items, notes } = body;

    if (!request_source) {
      return safeJsonError("request_source is required", 400, origin);
    }
    if (
      ![
        "service",
        "sales",
        "customer_walkin",
        "customer_phone",
        "internal",
      ].includes(request_source)
    ) {
      return safeJsonError("Invalid request_source", 400, origin);
    }

    const insertData = {
      requested_by: userId,
      request_source,
      priority: priority || "normal",
      status: "requested",
      machine_profile_id: body.machine_profile_id || null,
      machine_description: body.machine_description || null,
      customer_name: body.customer_name || null,
      bay_number: body.bay_number || null,
      work_order_number: body.work_order_number || null,
      items: (items || []).map((it) => ({
        part_number: it.part_number,
        description: it.description || null,
        quantity: it.quantity || 1,
        status: "pending",
        notes: it.notes || null,
      })),
      notes: notes || null,
    };

    const { data: newRequest, error } = await supabase
      .from("parts_requests")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("Create request failed:", error);
      return safeJsonError("Failed to create request", 500, origin);
    }

    await logActivity(supabase, {
      workspaceId: newRequest.workspace_id,
      requestId: newRequest.id,
      userId,
      action: "created",
      toValue: "requested",
      notes: notes || null,
      metadata: {
        source: request_source,
        item_count: (items || []).length,
      },
    });

    return safeJsonOk({ request: newRequest }, origin, 201);
  }

  // ── All other actions require request_id ────────────────

  if (!body.request_id) {
    return safeJsonError("request_id is required for this action", 400, origin);
  }

  const request = await fetchRequest(supabase, body.request_id);
  if (!request) {
    return safeJsonError("Request not found", 404, origin);
  }

  // ── ASSIGN ──────────────────────────────────────────────

  if (action === "assign") {
    const assignTo = body.assign_to || userId; // Default: assign to self

    const { error } = await supabase
      .from("parts_requests")
      .update({
        assigned_to: assignTo,
        status:
          request.status === "requested" ? "acknowledged" : request.status,
      })
      .eq("id", body.request_id);

    if (error) {
      return safeJsonError("Failed to assign request", 500, origin);
    }

    await logActivity(supabase, {
      workspaceId: request.workspace_id,
      requestId: body.request_id,
      userId,
      action: "assigned",
      toValue: assignTo,
      metadata: { assigned_to: assignTo },
    });

    return safeJsonOk({ success: true, assigned_to: assignTo }, origin);
  }

  // ── UPDATE STATUS ───────────────────────────────────────

  if (action === "update_status") {
    const { new_status } = body;
    if (!new_status) {
      return safeJsonError("new_status is required", 400, origin);
    }

    const validNextStates = VALID_TRANSITIONS[request.status] || [];
    if (!validNextStates.includes(new_status)) {
      return safeJsonError(
        `Invalid transition: ${request.status} → ${new_status}. Valid next states: ${validNextStates.join(", ") || "none (terminal state)"}`,
        422,
        origin,
      );
    }

    const updateData: Record<string, unknown> = { status: new_status };
    if (new_status === "fulfilled") updateData.fulfilled_at = new Date().toISOString();
    if (new_status === "cancelled") updateData.cancelled_at = new Date().toISOString();

    const { error } = await supabase
      .from("parts_requests")
      .update(updateData)
      .eq("id", body.request_id);

    if (error) {
      return safeJsonError("Failed to update status", 500, origin);
    }

    await logActivity(supabase, {
      workspaceId: request.workspace_id,
      requestId: body.request_id,
      userId,
      action: "status_change",
      fromValue: request.status,
      toValue: new_status,
      notes: body.notes || null,
    });

    return safeJsonOk(
      { success: true, from_status: request.status, to_status: new_status },
      origin,
    );
  }

  // ── ADD NOTE ────────────────────────────────────────────

  if (action === "add_note") {
    if (!body.notes) {
      return safeJsonError("notes is required", 400, origin);
    }

    await logActivity(supabase, {
      workspaceId: request.workspace_id,
      requestId: body.request_id,
      userId,
      action: "note_added",
      notes: body.notes,
    });

    return safeJsonOk({ success: true }, origin);
  }

  // ── ADD ITEM ────────────────────────────────────────────

  if (action === "add_item") {
    if (!body.item || !body.item.part_number) {
      return safeJsonError("item with part_number is required", 400, origin);
    }

    const updatedItems = [
      ...(request.items || []),
      {
        part_number: body.item.part_number,
        description: body.item.description || null,
        quantity: body.item.quantity || 1,
        status: "pending",
        notes: body.item.notes || null,
      },
    ];

    const { error } = await supabase
      .from("parts_requests")
      .update({ items: updatedItems })
      .eq("id", body.request_id);

    if (error) {
      return safeJsonError("Failed to add item", 500, origin);
    }

    await logActivity(supabase, {
      workspaceId: request.workspace_id,
      requestId: body.request_id,
      userId,
      action: "item_added",
      notes: `Added ${body.item.part_number}`,
      metadata: { part_number: body.item.part_number },
    });

    return safeJsonOk({ success: true, items: updatedItems }, origin);
  }

  // ── REMOVE ITEM ─────────────────────────────────────────

  if (action === "remove_item") {
    if (body.item_index === undefined || body.item_index === null) {
      return safeJsonError("item_index is required", 400, origin);
    }

    const items = [...(request.items || [])];
    if (body.item_index < 0 || body.item_index >= items.length) {
      return safeJsonError("item_index out of range", 400, origin);
    }

    const removed = items.splice(body.item_index, 1)[0];

    const { error } = await supabase
      .from("parts_requests")
      .update({ items })
      .eq("id", body.request_id);

    if (error) {
      return safeJsonError("Failed to remove item", 500, origin);
    }

    await logActivity(supabase, {
      workspaceId: request.workspace_id,
      requestId: body.request_id,
      userId,
      action: "item_removed",
      notes: `Removed ${removed?.part_number || "item"}`,
      metadata: { removed_item: removed },
    });

    return safeJsonOk({ success: true, items }, origin);
  }

  // ── COMPLETE ────────────────────────────────────────────

  if (action === "complete") {
    const validNextStates = VALID_TRANSITIONS[request.status] || [];
    if (!validNextStates.includes("fulfilled")) {
      return safeJsonError(
        `Cannot complete from status: ${request.status}. Must be in 'ready' state first.`,
        422,
        origin,
      );
    }

    const { error } = await supabase
      .from("parts_requests")
      .update({
        status: "fulfilled",
        fulfilled_at: new Date().toISOString(),
      })
      .eq("id", body.request_id);

    if (error) {
      return safeJsonError("Failed to complete request", 500, origin);
    }

    const durationMinutes = Math.round(
      (Date.now() - new Date(request.created_at).getTime()) / 60000,
    );

    await logActivity(supabase, {
      workspaceId: request.workspace_id,
      requestId: body.request_id,
      userId,
      action: "status_change",
      fromValue: request.status,
      toValue: "fulfilled",
      notes: body.notes || null,
      metadata: {
        duration_minutes: durationMinutes,
        item_count: (request.items || []).length,
      },
    });

    return safeJsonOk(
      { success: true, status: "fulfilled", duration_minutes: durationMinutes },
      origin,
    );
  }

  // ── CANCEL ──────────────────────────────────────────────

  if (action === "cancel") {
    if (request.status === "fulfilled") {
      return safeJsonError("Cannot cancel a fulfilled request", 422, origin);
    }
    if (request.status === "cancelled") {
      return safeJsonError("Request is already cancelled", 422, origin);
    }

    const { error } = await supabase
      .from("parts_requests")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", body.request_id);

    if (error) {
      return safeJsonError("Failed to cancel request", 500, origin);
    }

    await logActivity(supabase, {
      workspaceId: request.workspace_id,
      requestId: body.request_id,
      userId,
      action: "status_change",
      fromValue: request.status,
      toValue: "cancelled",
      notes: body.notes || `Cancelled by user`,
    });

    return safeJsonOk({ success: true, status: "cancelled" }, origin);
  }

  return safeJsonError(`Unknown action: ${action}`, 400, origin);
});
