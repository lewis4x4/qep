/**
 * Staff parts orders: internal/counter/phone order CRUD, status transitions,
 * inventory pick, and fulfillment run creation.
 * Auth: user JWT (requireServiceUser).
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

type Action =
  | "create_internal_order"
  | "submit_internal_order"
  | "update_internal_order"
  | "update_order_lines"
  | "advance_status"
  | "pick_order_line";

interface Body {
  action: Action;
  crm_company_id?: string;
  order_source?: string;
  notes?: string | null;
  line_items?: Array<Record<string, unknown>>;
  fleet_id?: string | null;
  shipping_address?: Record<string, unknown> | null;
  parts_order_id?: string;
  tracking_number?: string | null;
  estimated_delivery?: string | null;
  new_status?: string;
  parts_order_line_id?: string;
  branch_id?: string;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["cancelled"],
  submitted: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
};

function num(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function sanitizeLineItems(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const part_number =
      typeof o.part_number === "string" ? o.part_number.trim().slice(0, 120) : "";
    if (!part_number) continue;
    const quantity = Math.max(1, Math.min(99_999, Math.floor(num(o.quantity) ?? 1)));
    const description =
      typeof o.description === "string" ? o.description.trim().slice(0, 500) : null;
    const unit_price = num(o.unit_price);
    const line: Record<string, unknown> = {
      part_number,
      quantity,
      description,
      is_ai_suggested: false,
    };
    if (unit_price != null && unit_price >= 0) {
      line.unit_price = Math.round(unit_price * 10000) / 10000;
    }
    out.push(line);
  }
  return out.slice(0, 200);
}

function totalsFromLines(lines: Array<Record<string, unknown>>): {
  subtotal: number;
  total: number;
} {
  let subtotal = 0;
  for (const line of lines) {
    const q = Number(line.quantity) || 1;
    const up = num(line.unit_price);
    if (up != null) subtotal += up * q;
  }
  return { subtotal, total: subtotal };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  const supabase = auth.supabase;
  const userId = auth.userId;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }

  const { action } = body;

  // ── CREATE ──────────────────────────────────────────────────────────
  if (action === "create_internal_order") {
    const crmCompanyId =
      typeof body.crm_company_id === "string" ? body.crm_company_id.trim() : "";
    if (!crmCompanyId) {
      return safeJsonError("crm_company_id is required", 400, origin);
    }
    const lineItems = sanitizeLineItems(body.line_items);
    if (lineItems.length === 0) {
      return safeJsonError("line_items must contain at least one part line", 400, origin);
    }

    const srcRaw = typeof body.order_source === "string" ? body.order_source.trim() : "counter";
    const orderSource = ["counter", "phone", "online", "transfer"].includes(srcRaw)
      ? srcRaw
      : "counter";

    const { data: wsRow, error: wsErr } = await supabase
      .from("crm_companies")
      .select("id, workspace_id")
      .eq("id", crmCompanyId)
      .maybeSingle();
    if (wsErr || !wsRow?.id || !wsRow.workspace_id) {
      return safeJsonError("Company not found", 404, origin);
    }

    const { subtotal, total } = totalsFromLines(lineItems);
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : null;
    const fleetId =
      typeof body.fleet_id === "string" && body.fleet_id.trim()
        ? body.fleet_id.trim()
        : null;

    const insertRow: Record<string, unknown> = {
      workspace_id: wsRow.workspace_id,
      status: "draft",
      portal_customer_id: null,
      crm_company_id: crmCompanyId,
      order_source: orderSource,
      created_by: userId,
      notes,
      line_items: lineItems,
      fleet_id: fleetId,
      shipping_address: body.shipping_address ?? null,
      subtotal,
      tax: 0,
      shipping: 0,
      total,
    };

    const { data: order, error: insErr } = await supabase
      .from("parts_orders")
      .insert(insertRow)
      .select()
      .single();

    if (insErr) {
      console.error("parts-order-manager create:", insErr);
      return safeJsonError(insErr.message ?? "Failed to create order", 400, origin);
    }

    const orderId = order?.id as string;
    const lineRows = lineItems.map((line, idx) => ({
      parts_order_id: orderId,
      part_number: String(line.part_number),
      description: line.description != null ? String(line.description) : null,
      quantity: Number(line.quantity) || 1,
      unit_price: line.unit_price != null ? Number(line.unit_price) : null,
      line_total:
        line.unit_price != null
          ? Number(line.unit_price) * (Number(line.quantity) || 1)
          : null,
      sort_order: idx,
    }));

    const { error: lineErr } = await supabase.from("parts_order_lines").insert(lineRows);
    if (lineErr) {
      console.error("parts-order-manager lines:", lineErr);
      await supabase.from("parts_orders").delete().eq("id", orderId);
      return safeJsonError("Failed to create order lines", 500, origin);
    }

    return safeJsonOk({ order }, origin, 201);
  }

  // ── SUBMIT ──────────────────────────────────────────────────────────
  if (action === "submit_internal_order") {
    const orderId =
      typeof body.parts_order_id === "string" ? body.parts_order_id.trim() : "";
    if (!orderId) {
      return safeJsonError("parts_order_id is required", 400, origin);
    }

    const { data: row, error: fetchErr } = await supabase
      .from("parts_orders")
      .select("id, status, workspace_id, portal_customer_id, crm_company_id, order_source")
      .eq("id", orderId)
      .maybeSingle();

    if (fetchErr || !row) {
      return safeJsonError("Order not found", 404, origin);
    }
    if (row.status !== "draft") {
      return safeJsonError("Only draft orders can be submitted", 400, origin);
    }
    if (!row.crm_company_id) {
      return safeJsonError("Internal submit requires crm_company_id on order", 400, origin);
    }

    const { data: run, error: runErr } = await supabase
      .from("parts_fulfillment_runs")
      .insert({ workspace_id: row.workspace_id, status: "submitted" })
      .select("id")
      .single();

    if (runErr || !run?.id) {
      console.error("parts-order-manager run:", runErr);
      return safeJsonError("Failed to create fulfillment run", 500, origin);
    }

    const { data: updated, error: upErr } = await supabase
      .from("parts_orders")
      .update({ status: "submitted", fulfillment_run_id: run.id })
      .eq("id", orderId)
      .select()
      .single();

    if (upErr) {
      console.error("parts-order-manager submit:", upErr);
      await supabase.from("parts_fulfillment_runs").delete().eq("id", run.id);
      return safeJsonError("Failed to submit order", 500, origin);
    }

    const { error: evErr } = await supabase.from("parts_fulfillment_events").insert({
      workspace_id: row.workspace_id,
      fulfillment_run_id: run.id,
      event_type: "internal_order_submitted",
      payload: {
        parts_order_id: orderId,
        order_source: row.order_source ?? "counter",
        audit_channel: "shop",
      },
    });
    if (evErr) {
      console.warn("parts-order-manager event:", evErr);
    }

    return safeJsonOk({ order: updated, fulfillment_run_id: run.id }, origin);
  }

  // ── UPDATE ORDER FIELDS ─────────────────────────────────────────────
  if (action === "update_internal_order") {
    const orderId =
      typeof body.parts_order_id === "string" ? body.parts_order_id.trim() : "";
    if (!orderId) {
      return safeJsonError("parts_order_id is required", 400, origin);
    }

    const { data: row, error: fetchErr } = await supabase
      .from("parts_orders")
      .select("id, status")
      .eq("id", orderId)
      .maybeSingle();

    if (fetchErr || !row) {
      return safeJsonError("Order not found", 404, origin);
    }
    if (row.status !== "draft") {
      return safeJsonError("Only draft orders can be edited", 400, origin);
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.notes === "string") patch.notes = body.notes.trim().slice(0, 4000);
    if (typeof body.order_source === "string") {
      const src = body.order_source.trim();
      if (["counter", "phone", "online", "transfer"].includes(src)) {
        patch.order_source = src;
      }
    }
    if (body.shipping_address !== undefined) {
      patch.shipping_address = body.shipping_address;
    }

    if (Object.keys(patch).length === 0) {
      return safeJsonError("No fields to update", 400, origin);
    }

    const { data: updated, error: upErr } = await supabase
      .from("parts_orders")
      .update(patch)
      .eq("id", orderId)
      .select()
      .single();

    if (upErr) {
      console.error("parts-order-manager update:", upErr);
      return safeJsonError(upErr.message ?? "Failed to update order", 400, origin);
    }

    return safeJsonOk({ order: updated }, origin);
  }

  // ── UPDATE ORDER LINES ──────────────────────────────────────────────
  if (action === "update_order_lines") {
    const orderId =
      typeof body.parts_order_id === "string" ? body.parts_order_id.trim() : "";
    if (!orderId) {
      return safeJsonError("parts_order_id is required", 400, origin);
    }

    const { data: row, error: fetchErr } = await supabase
      .from("parts_orders")
      .select("id, status, workspace_id")
      .eq("id", orderId)
      .maybeSingle();

    if (fetchErr || !row) {
      return safeJsonError("Order not found", 404, origin);
    }
    if (row.status !== "draft") {
      return safeJsonError("Lines can only be updated on draft orders", 400, origin);
    }

    const lineItems = sanitizeLineItems(body.line_items);
    if (lineItems.length === 0) {
      return safeJsonError("line_items must contain at least one part line", 400, origin);
    }

    const { data: existingLines, error: existingErr } = await supabase
      .from("parts_order_lines")
      .select("part_number, description, quantity, unit_price, line_total, sort_order")
      .eq("parts_order_id", orderId)
      .order("sort_order");
    if (existingErr) {
      console.error("parts-order-manager load lines:", existingErr);
      return safeJsonError("Failed to load existing lines", 500, origin);
    }

    const { error: delErr } = await supabase
      .from("parts_order_lines")
      .delete()
      .eq("parts_order_id", orderId);
    if (delErr) {
      console.error("parts-order-manager delete lines:", delErr);
      return safeJsonError("Failed to clear existing lines", 500, origin);
    }

    const lineRows = lineItems.map((line, idx) => ({
      parts_order_id: orderId,
      part_number: String(line.part_number),
      description: line.description != null ? String(line.description) : null,
      quantity: Number(line.quantity) || 1,
      unit_price: line.unit_price != null ? Number(line.unit_price) : null,
      line_total:
        line.unit_price != null
          ? Number(line.unit_price) * (Number(line.quantity) || 1)
          : null,
      sort_order: idx,
    }));

    const { error: insErr } = await supabase.from("parts_order_lines").insert(lineRows);
    if (insErr) {
      console.error("parts-order-manager insert lines:", insErr);
      if ((existingLines ?? []).length > 0) {
        await supabase.from("parts_order_lines").insert(
          (existingLines ?? []).map((line) => ({
            ...line,
            parts_order_id: orderId,
          })),
        );
      }
      return safeJsonError("Failed to insert new lines", 500, origin);
    }

    const { subtotal, total } = totalsFromLines(lineItems);
    const { error: upErr } = await supabase
      .from("parts_orders")
      .update({ line_items: lineItems, subtotal, total })
      .eq("id", orderId);
    if (upErr) {
      console.error("parts-order-manager sync totals:", upErr);
      await supabase.from("parts_order_lines").delete().eq("parts_order_id", orderId);
      if ((existingLines ?? []).length > 0) {
        await supabase.from("parts_order_lines").insert(
          (existingLines ?? []).map((line) => ({
            ...line,
            parts_order_id: orderId,
          })),
        );
      }
      return safeJsonError("Failed to sync order totals", 500, origin);
    }

    return safeJsonOk({ lines: lineRows.length }, origin);
  }

  // ── ADVANCE STATUS ──────────────────────────────────────────────────
  if (action === "advance_status") {
    const orderId =
      typeof body.parts_order_id === "string" ? body.parts_order_id.trim() : "";
    const newStatus =
      typeof body.new_status === "string" ? body.new_status.trim() : "";

    if (!orderId) {
      return safeJsonError("parts_order_id is required", 400, origin);
    }
    if (!newStatus) {
      return safeJsonError("new_status is required", 400, origin);
    }

    const { data: row, error: fetchErr } = await supabase
      .from("parts_orders")
      .select("id, status, workspace_id")
      .eq("id", orderId)
      .maybeSingle();

    if (fetchErr || !row) {
      return safeJsonError("Order not found", 404, origin);
    }

    const allowed = VALID_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(newStatus)) {
      return safeJsonError(
        `Invalid transition from ${row.status} to ${newStatus}`,
        400,
        origin,
      );
    }
    if (row.status === "draft" && newStatus !== "cancelled") {
      return safeJsonError(
        "Draft orders must use submit_internal_order before status advancement",
        400,
        origin,
      );
    }

    const patch: Record<string, unknown> = { status: newStatus };
    if (newStatus === "shipped") {
      if (typeof body.tracking_number === "string" && body.tracking_number.trim()) {
        patch.tracking_number = body.tracking_number.trim();
      }
      if (typeof body.estimated_delivery === "string" && body.estimated_delivery.trim()) {
        patch.estimated_delivery = body.estimated_delivery.trim();
      }
    }

    const { data: updated, error: upErr } = await supabase
      .from("parts_orders")
      .update(patch)
      .eq("id", orderId)
      .select()
      .single();

    if (upErr) {
      console.error("parts-order-manager advance:", upErr);
      return safeJsonError(upErr.message ?? "Failed to advance status", 500, origin);
    }

    return safeJsonOk({ order: updated }, origin);
  }

  // ── PICK ORDER LINE ─────────────────────────────────────────────────
  if (action === "pick_order_line") {
    const orderId =
      typeof body.parts_order_id === "string" ? body.parts_order_id.trim() : "";
    const lineId =
      typeof body.parts_order_line_id === "string" ? body.parts_order_line_id.trim() : "";
    const branchId =
      typeof body.branch_id === "string" ? body.branch_id.trim() : "";

    if (!orderId || !lineId || !branchId) {
      return safeJsonError(
        "parts_order_id, parts_order_line_id, and branch_id are required",
        400,
        origin,
      );
    }

    const { data: order, error: oErr } = await supabase
      .from("parts_orders")
      .select("id, status, workspace_id")
      .eq("id", orderId)
      .maybeSingle();

    if (oErr || !order) {
      return safeJsonError("Order not found", 404, origin);
    }
    if (!["confirmed", "processing"].includes(order.status)) {
      return safeJsonError(
        "Pick is only allowed on confirmed or processing orders",
        400,
        origin,
      );
    }

    const { data: line, error: lErr } = await supabase
      .from("parts_order_lines")
      .select("id, part_number, quantity")
      .eq("id", lineId)
      .eq("parts_order_id", orderId)
      .maybeSingle();

    if (lErr || !line) {
      return safeJsonError("Order line not found", 404, origin);
    }
    if (!Number.isInteger(Number(line.quantity))) {
      return safeJsonError("Pick requires whole-number quantities", 400, origin);
    }

    const { error: rpcErr } = await supabase.rpc("adjust_parts_inventory_delta_strict", {
      p_workspace_id: order.workspace_id,
      p_branch_id: branchId,
      p_part_number: line.part_number,
      p_delta: -line.quantity,
    });

    if (rpcErr) {
      console.error("parts-order-manager pick rpc:", rpcErr);
      return safeJsonError(
        rpcErr.message ?? "Inventory pick failed (insufficient stock?)",
        400,
        origin,
      );
    }

    if (order.status === "confirmed") {
      await supabase.from("parts_orders").update({ status: "processing" }).eq("id", orderId);
    }

    const { data: run } = await supabase
      .from("parts_orders")
      .select("fulfillment_run_id")
      .eq("id", orderId)
      .maybeSingle();

    if (run?.fulfillment_run_id) {
      const { error: evErr } = await supabase.from("parts_fulfillment_events").insert({
        workspace_id: order.workspace_id,
        fulfillment_run_id: run.fulfillment_run_id,
        event_type: "counter_order_picked",
        payload: {
          parts_order_id: orderId,
          parts_order_line_id: lineId,
          part_number: line.part_number,
          quantity: line.quantity,
          branch_id: branchId,
          picked_by: userId,
        },
      });
      if (evErr) {
        console.warn("parts-order-manager pick event:", evErr);
      }
    }

    return safeJsonOk({
      picked: { line_id: lineId, part_number: line.part_number, quantity: line.quantity, branch_id: branchId },
    }, origin);
  }

  return safeJsonError(`Unknown action: ${String(action)}`, 400, origin);
});
