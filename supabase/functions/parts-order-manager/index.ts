/**
 * Staff parts orders: internal/counter/phone order CRUD, status transitions,
 * inventory pick, and fulfillment run creation.
 * Auth: user JWT (requireServiceUser).
 */
import {
  requireServiceUser,
  SERVICE_PARTS_ROLES,
} from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import {
  assertCounterReleaseAllowed,
  CounterPosRuleError,
  normalizeCounterTenderInput,
  type CounterTenderPatch,
  type CounterTenderState,
} from "./counter-pos-rules.ts";

type Action =
  | "create_internal_order"
  | "submit_internal_order"
  | "update_internal_order"
  | "update_order_lines"
  | "advance_status"
  | "pick_order_line"
  | "reserve_interbranch_transfer"
  | "create_parts_quote"
  | "convert_parts_quote_to_order";

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
  payment_classification?: string;
  payment_status?: string;
  payment_reference?: string | null;
  charge_authorization_status?: string;
  charge_authorization_note?: string | null;
  part_id?: string;
  from_location_id?: string;
  to_location_id?: string;
  quantity?: number;
  customer_choice?: string;
  scheduled_at?: string | null;
  oem_order_eta_days?: number;
  customer_id?: string;
  contact_id?: string | null;
  quote_source?: string;
  expires_at?: string | null;
  freight_estimate_cents?: number;
  freight_estimate_source?: string;
  parts_quote_id?: string;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["cancelled"],
  submitted: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
};

async function emitOrderEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    workspaceId: string;
    orderId: string;
    eventType: string;
    source?: string;
    actorId?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from("parts_order_events").insert({
      workspace_id: opts.workspaceId,
      parts_order_id: opts.orderId,
      event_type: opts.eventType,
      source: opts.source ?? "manual",
      actor_id: opts.actorId ?? null,
      from_status: opts.fromStatus ?? null,
      to_status: opts.toStatus ?? null,
      metadata: opts.metadata ?? {},
    });
  } catch (e) {
    console.warn("emitOrderEvent failed (non-blocking):", e);
  }
}

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

function counterPosErrorResponse(error: unknown, origin: string | null): Response | null {
  if (error instanceof CounterPosRuleError) {
    return safeJsonError(error.message, error.status, origin);
  }
  return null;
}

function hasTenderInput(body: Body): boolean {
  return body.payment_classification !== undefined ||
    body.payment_status !== undefined ||
    body.payment_reference !== undefined ||
    body.charge_authorization_status !== undefined ||
    body.charge_authorization_note !== undefined;
}

function receiptNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `POS-${day}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function partsQuoteNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `PQ-${day}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function moneyCents(x: unknown): number | null {
  const n = num(x);
  if (n == null || n < 0) return null;
  return Math.round(n * 100);
}

function sanitizeQuoteLines(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const partNumber =
      typeof o.part_number === "string" ? o.part_number.trim().slice(0, 120) : "";
    if (!partNumber) continue;
    const quantity = Math.max(1, Math.min(99_999, Math.floor(num(o.quantity) ?? 1)));
    const unitPriceCents = moneyCents(o.unit_price);
    if (unitPriceCents == null) continue;
    const description =
      typeof o.description === "string" ? o.description.trim().slice(0, 500) : null;
    const extendedPriceCents = unitPriceCents * quantity;
    out.push({
      part_number: partNumber,
      quantity,
      description,
      unit_price_cents: unitPriceCents,
      extended_price_cents: extendedPriceCents,
      discount_pct: num(o.discount_pct),
      part_catalog_id: typeof o.part_catalog_id === "string" ? o.part_catalog_id : null,
    });
  }
  return out.slice(0, 200);
}

function completeTenderPatch(
  patch: CounterTenderPatch,
  current: CounterTenderState | null | undefined,
  actorId: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  if (
    patch.payment_classification === "cash" &&
    patch.payment_status === "paid" &&
    current?.payment_status !== "paid"
  ) {
    out.payment_received_at = new Date().toISOString();
    out.receipt_number = receiptNumber();
  }
  if (
    patch.payment_classification === "charge" &&
    ["approved_credit", "exec_approved"].includes(patch.charge_authorization_status) &&
    current?.charge_authorization_status !== patch.charge_authorization_status
  ) {
    out.charge_authorized_by = actorId;
    out.charge_authorized_at = new Date().toISOString();
    out.receipt_number = receiptNumber();
  }
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const auth = await requireServiceUser(
    req.headers.get("Authorization"),
    origin,
    SERVICE_PARTS_ROLES,
  );
  if (!auth.ok) return auth.response;

  const supabase = auth.supabase;
  const userId = auth.userId;
  const workspaceId = auth.workspaceId;

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
    const orderSource = ["counter", "phone", "email", "online", "transfer"].includes(srcRaw)
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
    let tenderPatch: Record<string, unknown>;
    try {
      tenderPatch = completeTenderPatch(
        normalizeCounterTenderInput(body as unknown as Record<string, unknown>, null),
        null,
        userId,
      );
    } catch (e) {
      const response = counterPosErrorResponse(e, origin);
      if (response) return response;
      throw e;
    }

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
      ...tenderPatch,
    };

    const { data: order, error: insErr } = await supabase
      .from("parts_orders")
      .insert(insertRow)
      .select()
      .single();

    if (insErr) {
      console.error("parts-order-manager create:", insErr);
      return safeJsonError("Failed to create order", 400, origin);
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

    await emitOrderEvent(supabase, {
      workspaceId: wsRow.workspace_id,
      orderId,
      eventType: "created",
      actorId: userId,
      toStatus: "draft",
      metadata: {
        order_source: orderSource,
        line_count: lineRows.length,
        payment_classification: insertRow.payment_classification,
        payment_status: insertRow.payment_status,
        charge_authorization_status: insertRow.charge_authorization_status,
      },
    });

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
      .select(
        "id, status, workspace_id, portal_customer_id, crm_company_id, order_source, payment_classification, payment_status, charge_authorization_status",
      )
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
    try {
      assertCounterReleaseAllowed({ ...row, status: "submitted" });
    } catch (e) {
      const response = counterPosErrorResponse(e, origin);
      if (response) return response;
      throw e;
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
        payment_classification: row.payment_classification ?? "cash",
        payment_status: row.payment_status ?? "unpaid",
        charge_authorization_status: row.charge_authorization_status ?? "not_applicable",
        audit_channel: "shop",
      },
    });
    if (evErr) {
      console.warn("parts-order-manager event:", evErr);
    }

    await emitOrderEvent(supabase, {
      workspaceId: row.workspace_id,
      orderId,
      eventType: "submitted",
      actorId: userId,
      fromStatus: "draft",
      toStatus: "submitted",
      metadata: {
        fulfillment_run_id: run.id,
        payment_classification: row.payment_classification ?? "cash",
        payment_status: row.payment_status ?? "unpaid",
        charge_authorization_status: row.charge_authorization_status ?? "not_applicable",
      },
    });

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
      .select(
        "id, status, workspace_id, payment_classification, payment_status, charge_authorization_status",
      )
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
      if (["counter", "phone", "email", "online", "transfer"].includes(src)) {
        patch.order_source = src;
      }
    }
    if (body.shipping_address !== undefined) {
      patch.shipping_address = body.shipping_address;
    }
    if (hasTenderInput(body)) {
      try {
        Object.assign(
          patch,
          completeTenderPatch(
            normalizeCounterTenderInput(body as unknown as Record<string, unknown>, row),
            row,
            userId,
          ),
        );
      } catch (e) {
        const response = counterPosErrorResponse(e, origin);
        if (response) return response;
        throw e;
      }
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
      return safeJsonError("Failed to update order", 400, origin);
    }

    await emitOrderEvent(supabase, {
      workspaceId: (updated as Record<string, unknown>)?.workspace_id as string ?? "default",
      orderId,
      eventType: "fields_updated",
      actorId: userId,
      metadata: { updated_fields: Object.keys(patch) },
    });

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
      .select(
        "id, status, workspace_id, order_source, payment_classification, payment_status, charge_authorization_status",
      )
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

    await emitOrderEvent(supabase, {
      workspaceId: row.workspace_id,
      orderId,
      eventType: "lines_updated",
      actorId: userId,
      metadata: { new_line_count: lineRows.length },
    });

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
    try {
      assertCounterReleaseAllowed({ ...row, status: newStatus });
    } catch (e) {
      const response = counterPosErrorResponse(e, origin);
      if (response) return response;
      throw e;
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
      return safeJsonError("Failed to advance status", 500, origin);
    }

    await emitOrderEvent(supabase, {
      workspaceId: row.workspace_id,
      orderId,
      eventType: newStatus as string,
      actorId: userId,
      fromStatus: row.status,
      toStatus: newStatus,
      metadata: patch,
    });

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
      .select(
        "id, status, workspace_id, order_source, payment_classification, payment_status, charge_authorization_status",
      )
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
    try {
      assertCounterReleaseAllowed(order);
    } catch (e) {
      const response = counterPosErrorResponse(e, origin);
      if (response) return response;
      throw e;
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

    await emitOrderEvent(supabase, {
      workspaceId: order.workspace_id,
      orderId,
      eventType: "pick_completed",
      actorId: userId,
      metadata: {
        line_id: lineId,
        part_number: line.part_number,
        quantity: line.quantity,
        branch_id: branchId,
      },
    });

    return safeJsonOk({
      picked: { line_id: lineId, part_number: line.part_number, quantity: line.quantity, branch_id: branchId },
    }, origin);
  }

  // ── RESERVE INTER-BRANCH TRANSFER ───────────────────────────────────
  if (action === "reserve_interbranch_transfer") {
    const partId = typeof body.part_id === "string" ? body.part_id.trim() : "";
    const fromLocationId =
      typeof body.from_location_id === "string" ? body.from_location_id.trim() : "";
    const toLocationId =
      typeof body.to_location_id === "string" ? body.to_location_id.trim() : "";
    const orderId =
      typeof body.parts_order_id === "string" && body.parts_order_id.trim()
        ? body.parts_order_id.trim()
        : null;
    const quantity = num(body.quantity) ?? 1;
    const customerChoice =
      typeof body.customer_choice === "string" && body.customer_choice.trim()
        ? body.customer_choice.trim()
        : "transfer";
    const scheduledAt =
      typeof body.scheduled_at === "string" && body.scheduled_at.trim()
        ? body.scheduled_at.trim()
        : null;
    const oemOrderEtaDays = Math.max(
      0,
      Math.floor(num(body.oem_order_eta_days) ?? 3),
    );

    if (!partId || !fromLocationId || !toLocationId) {
      return safeJsonError(
        "part_id, from_location_id, and to_location_id are required",
        400,
        origin,
      );
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return safeJsonError("quantity must be greater than zero", 400, origin);
    }
    if (!["transfer", "oem_order"].includes(customerChoice)) {
      return safeJsonError("customer_choice must be transfer or oem_order", 400, origin);
    }

    const { data: reservation, error: reserveErr } = await supabase.rpc(
      "parts_reserve_interbranch_transfer",
      {
        p_part_id: partId,
        p_from_location_id: fromLocationId,
        p_to_location_id: toLocationId,
        p_quantity: quantity,
        p_customer_choice: customerChoice,
        p_parts_order_id: orderId,
        p_requested_by: userId,
        p_scheduled_at: scheduledAt,
        p_oem_order_eta_days: oemOrderEtaDays,
        p_workspace_id: workspaceId,
      },
    );

    if (reserveErr) {
      console.error("parts-order-manager transfer reservation:", reserveErr);
      return safeJsonError(
        reserveErr.message ?? "Transfer reservation failed",
        400,
        origin,
      );
    }

    if (
      orderId &&
      reservation &&
      typeof reservation === "object" &&
      (reservation as Record<string, unknown>).status === "reserved"
    ) {
      await emitOrderEvent(supabase, {
        workspaceId,
        orderId,
        eventType: "transfer_reserved",
        actorId: userId,
        metadata: reservation as Record<string, unknown>,
      });
    }

    return safeJsonOk({ reservation }, origin, 201);
  }

  // ── CREATE PARTS QUOTE ──────────────────────────────────────────────
  if (action === "create_parts_quote") {
    const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : "";
    const contactId =
      typeof body.contact_id === "string" && body.contact_id.trim()
        ? body.contact_id.trim()
        : null;
    const quoteSourceRaw =
      typeof body.quote_source === "string" ? body.quote_source.trim() : "phone";
    const quoteSource =
      ["counter", "phone", "email", "walkin", "service", "online"].includes(quoteSourceRaw)
        ? quoteSourceRaw
        : "phone";
    const freightEstimateCents = Math.max(
      0,
      Math.floor(num(body.freight_estimate_cents) ?? 0),
    );
    const freightSourceRaw =
      typeof body.freight_estimate_source === "string"
        ? body.freight_estimate_source.trim()
        : "unknown";
    const freightEstimateSource = [
        "vendor_estimate",
        "staff_estimate",
        "not_required",
        "unknown",
      ].includes(freightSourceRaw)
      ? freightSourceRaw
      : "unknown";
    const expiresAt =
      typeof body.expires_at === "string" && body.expires_at.trim()
        ? body.expires_at.trim()
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : null;
    const description =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null;
    const quoteLines = sanitizeQuoteLines(body.line_items);

    if (!customerId) {
      return safeJsonError("customer_id is required", 400, origin);
    }
    if (quoteLines.length === 0) {
      return safeJsonError(
        "line_items must contain at least one priced part line",
        400,
        origin,
      );
    }

    const subtotalCents = quoteLines.reduce(
      (sum, line) => sum + Number(line.extended_price_cents),
      0,
    );
    const totalCents = subtotalCents + freightEstimateCents;

    const { data: quote, error: quoteErr } = await supabase
      .from("parts_quotes")
      .insert({
        workspace_id: workspaceId,
        quote_number: partsQuoteNumber(),
        customer_id: customerId,
        contact_id: contactId,
        salesperson_id: userId,
        assigned_salesperson_id: userId,
        description,
        status: "draft",
        expiry_date: expiresAt.slice(0, 10),
        expires_at: expiresAt,
        quote_source: quoteSource,
        freight_estimate_cents: freightEstimateCents,
        freight_estimate_source: freightEstimateSource,
        payment_rule: "cash_up_front_including_freight",
        subtotal_cents: subtotalCents,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: totalCents,
        notes,
        metadata: {
          source: "parts-order-manager",
          payment_rule: "cash_up_front_including_freight",
        },
      })
      .select()
      .single();

    if (quoteErr || !quote?.id) {
      console.error("parts-order-manager quote create:", quoteErr);
      return safeJsonError("Failed to create parts quote", 400, origin);
    }

    const lineRows = quoteLines.map((line, idx) => ({
      workspace_id: workspaceId,
      parts_quote_id: quote.id,
      sort_order: idx,
      part_catalog_id: line.part_catalog_id,
      part_number: line.part_number,
      description: line.description,
      qty: line.quantity,
      unit_price_cents: line.unit_price_cents,
      discount_pct: line.discount_pct,
      extended_price_cents: line.extended_price_cents,
    }));

    const { error: linesErr } = await supabase.from("parts_quote_lines").insert(lineRows);
    if (linesErr) {
      console.error("parts-order-manager quote lines:", linesErr);
      await supabase.from("parts_quotes").delete().eq("id", quote.id);
      return safeJsonError("Failed to create parts quote lines", 500, origin);
    }

    return safeJsonOk({ quote, lines: lineRows.length }, origin, 201);
  }

  // ── CONVERT PARTS QUOTE TO ORDER ────────────────────────────────────
  if (action === "convert_parts_quote_to_order") {
    const quoteId =
      typeof body.parts_quote_id === "string" ? body.parts_quote_id.trim() : "";
    const crmCompanyId =
      typeof body.crm_company_id === "string" ? body.crm_company_id.trim() : "";
    const orderSource =
      typeof body.order_source === "string" && body.order_source.trim()
        ? body.order_source.trim()
        : null;
    const paymentClassification =
      typeof body.payment_classification === "string" && body.payment_classification.trim()
        ? body.payment_classification.trim()
        : "cash";

    if (!quoteId || !crmCompanyId) {
      return safeJsonError(
        "parts_quote_id and crm_company_id are required",
        400,
        origin,
      );
    }

    const { data: conversion, error: convertErr } = await supabase.rpc(
      "parts_convert_quote_to_order",
      {
        p_parts_quote_id: quoteId,
        p_crm_company_id: crmCompanyId,
        p_order_source: orderSource,
        p_payment_classification: paymentClassification,
        p_created_by: userId,
        p_workspace_id: workspaceId,
      },
    );

    if (convertErr) {
      console.error("parts-order-manager quote conversion:", convertErr);
      return safeJsonError(
        convertErr.message ?? "Failed to convert parts quote",
        400,
        origin,
      );
    }

    return safeJsonOk({ conversion }, origin, 201);
  }

  return safeJsonError(`Unknown action: ${String(action)}`, 400, origin);
});
