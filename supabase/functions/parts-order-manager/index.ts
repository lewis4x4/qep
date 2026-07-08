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
  type CounterTenderPatch,
  type CounterTenderState,
  normalizeCounterTenderInput,
} from "./counter-pos-rules.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { generateInvoiceForPartsOrder } from "../_shared/parts-invoice.ts";

type Action =
  | "create_internal_order"
  | "submit_internal_order"
  | "update_internal_order"
  | "update_order_lines"
  | "advance_status"
  | "pick_order_line"
  | "reserve_interbranch_transfer"
  | "create_parts_quote"
  | "convert_parts_quote_to_order"
  | "decide_line_discount";

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
  tender_type?: string | null;
  tender_amount?: number | null;
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
  line_type?: string;
  line_id?: string;
  discount_decision?: string;
  discount_reason?: string | null;
}

type ResolvedPricedLine = {
  part_catalog_id: string | null;
  part_id: string | null;
  part_number: string;
  description: string | null;
  price_source: string;
  price_source_id: string | null;
  pricing_rule_id: string | null;
  list_unit_price_cents: number;
  base_unit_price_cents: number;
  final_unit_price_cents: number;
  requested_discount_pct: number;
  applied_discount_pct: number;
  discount_authority: string;
  discount_approval_status: string;
  margin_floor_applied: boolean;
  pricing_metadata: Record<string, unknown>;
};

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
    const part_number = typeof o.part_number === "string"
      ? o.part_number.trim().slice(0, 120)
      : "";
    if (!part_number) continue;
    const quantity = Math.max(
      1,
      Math.min(99_999, Math.floor(num(o.quantity) ?? 1)),
    );
    const description = typeof o.description === "string"
      ? o.description.trim().slice(0, 500)
      : null;
    const unit_price = num(o.unit_price);
    const discount_pct = num(o.discount_pct) ?? num(o.requested_discount_pct);
    const line: Record<string, unknown> = {
      part_number,
      quantity,
      description,
      is_ai_suggested: false,
    };
    if (typeof o.part_catalog_id === "string" && o.part_catalog_id.trim()) {
      line.part_catalog_id = o.part_catalog_id.trim();
    }
    if (discount_pct != null && discount_pct >= 0) {
      line.requested_discount_pct = Math.min(
        100,
        Math.round(discount_pct * 100) / 100,
      );
    }
    if (unit_price != null && unit_price >= 0) {
      line.unit_price = Math.round(unit_price * 10000) / 10000;
    }
    out.push(line);
  }
  return out.slice(0, 200);
}

function counterPosErrorResponse(
  error: unknown,
  origin: string | null,
): Response | null {
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
    const partNumber = typeof o.part_number === "string"
      ? o.part_number.trim().slice(0, 120)
      : "";
    if (!partNumber) continue;
    const quantity = Math.max(
      1,
      Math.min(99_999, Math.floor(num(o.quantity) ?? 1)),
    );
    const description = typeof o.description === "string"
      ? o.description.trim().slice(0, 500)
      : null;
    const requestedDiscountPct = num(o.discount_pct) ??
      num(o.requested_discount_pct) ?? 0;
    out.push({
      part_number: partNumber,
      quantity,
      description,
      discount_pct: Math.min(
        100,
        Math.max(0, Math.round(requestedDiscountPct * 100) / 100),
      ),
      part_catalog_id: typeof o.part_catalog_id === "string"
        ? o.part_catalog_id
        : null,
    });
  }
  return out.slice(0, 200);
}

class PricingResolverError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PricingResolverError";
    this.status = status;
  }
}

function centsToDollars(cents: number): number {
  return Math.round((cents / 100) * 10000) / 10000;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pricingErrorResponse(
  error: unknown,
  origin: string | null,
): Response | null {
  if (error instanceof PricingResolverError) {
    return safeJsonError(error.message, error.status, origin);
  }
  return null;
}

async function resolvePricedLine(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  line: Record<string, unknown>,
  context: { crmCompanyId?: string | null; qrmCompanyId?: string | null },
): Promise<ResolvedPricedLine> {
  const partNumber = typeof line.part_number === "string"
    ? line.part_number
    : "";
  const partCatalogId =
    typeof line.part_catalog_id === "string" && line.part_catalog_id.trim()
      ? line.part_catalog_id.trim()
      : null;
  const quantity = Number(line.quantity) || 1;
  const requestedDiscountPct = num(line.requested_discount_pct) ??
    num(line.discount_pct) ?? 0;

  const { data, error } = await supabase
    .rpc("parts_resolve_priced_line", {
      p_part_number: partNumber,
      p_part_catalog_id: partCatalogId,
      p_qrm_company_id: context.qrmCompanyId ?? null,
      p_crm_company_id: context.crmCompanyId ?? null,
      p_quantity: quantity,
      p_requested_discount_pct: requestedDiscountPct,
    })
    .single();

  if (error || !data) {
    console.error("parts-order-manager pricing resolver:", error);
    throw new PricingResolverError(
      `Failed to price part ${partNumber || partCatalogId || "(unknown)"}`,
      400,
    );
  }

  const row = data as Record<string, unknown>;
  return {
    part_catalog_id: typeof row.part_catalog_id === "string"
      ? row.part_catalog_id
      : null,
    part_id: typeof row.part_id === "string" ? row.part_id : null,
    part_number: String(row.part_number ?? partNumber),
    description: typeof row.description === "string" ? row.description : null,
    price_source: String(row.price_source ?? "list_price"),
    price_source_id: typeof row.price_source_id === "string"
      ? row.price_source_id
      : null,
    pricing_rule_id: typeof row.pricing_rule_id === "string"
      ? row.pricing_rule_id
      : null,
    list_unit_price_cents: Number(row.list_unit_price_cents) || 0,
    base_unit_price_cents: Number(row.base_unit_price_cents) || 0,
    final_unit_price_cents: Number(row.final_unit_price_cents) || 0,
    requested_discount_pct: Number(row.requested_discount_pct) || 0,
    applied_discount_pct: Number(row.applied_discount_pct) || 0,
    discount_authority: String(row.discount_authority ?? "none"),
    discount_approval_status: String(
      row.discount_approval_status ?? "not_required",
    ),
    margin_floor_applied: Boolean(row.margin_floor_applied),
    pricing_metadata: objectValue(row.pricing_metadata),
  };
}

async function resolveOrderLineRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  lineItems: Array<Record<string, unknown>>,
  crmCompanyId: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [idx, line] of lineItems.entries()) {
    const priced = await resolvePricedLine(supabase, line, { crmCompanyId });
    const quantity = Number(line.quantity) || 1;
    const unitPrice = centsToDollars(priced.final_unit_price_cents);
    out.push({
      catalog_item_id: priced.part_catalog_id,
      part_id: priced.part_id,
      part_number: priced.part_number,
      description: line.description != null
        ? String(line.description)
        : priced.description,
      quantity,
      unit_price: unitPrice,
      line_total: Math.round(unitPrice * quantity * 10000) / 10000,
      sort_order: idx,
      price_source: priced.price_source,
      price_source_id: priced.price_source_id,
      pricing_rule_id: priced.pricing_rule_id,
      requested_discount_pct: priced.requested_discount_pct,
      applied_discount_pct: priced.applied_discount_pct,
      discount_authority: priced.discount_authority,
      discount_approval_status: priced.discount_approval_status,
      list_unit_price: centsToDollars(priced.list_unit_price_cents),
      base_unit_price: centsToDollars(priced.base_unit_price_cents),
      final_unit_price: unitPrice,
      margin_floor_applied: priced.margin_floor_applied,
      pricing_metadata: priced.pricing_metadata,
    });
  }
  return out;
}

async function resolveQuoteLineRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  lineItems: Array<Record<string, unknown>>,
  qrmCompanyId: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [idx, line] of lineItems.entries()) {
    const priced = await resolvePricedLine(supabase, line, { qrmCompanyId });
    const quantity = Number(line.quantity) || 1;
    out.push({
      sort_order: idx,
      part_catalog_id: priced.part_catalog_id,
      part_id: priced.part_id,
      part_number: priced.part_number,
      description: line.description != null
        ? String(line.description)
        : priced.description,
      qty: quantity,
      unit_price_cents: priced.final_unit_price_cents,
      discount_pct: priced.requested_discount_pct,
      extended_price_cents: priced.final_unit_price_cents * quantity,
      price_source: priced.price_source,
      price_source_id: priced.price_source_id,
      pricing_rule_id: priced.pricing_rule_id,
      requested_discount_pct: priced.requested_discount_pct,
      applied_discount_pct: priced.applied_discount_pct,
      discount_authority: priced.discount_authority,
      discount_approval_status: priced.discount_approval_status,
      list_unit_price_cents: priced.list_unit_price_cents,
      base_unit_price_cents: priced.base_unit_price_cents,
      final_unit_price_cents: priced.final_unit_price_cents,
      margin_floor_applied: priced.margin_floor_applied,
      pricing_metadata: priced.pricing_metadata,
    });
  }
  return out;
}

function totalsFromOrderLineRows(lines: Array<Record<string, unknown>>): {
  subtotal: number;
  total: number;
} {
  const subtotal = lines.reduce(
    (sum, line) => sum + (Number(line.line_total) || 0),
    0,
  );
  return {
    subtotal: Math.round(subtotal * 10000) / 10000,
    total: Math.round(subtotal * 10000) / 10000,
  };
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
    ["approved_credit", "exec_approved"].includes(
      patch.charge_authorization_status,
    ) &&
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
  const userRole = auth.role;
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
    const crmCompanyId = typeof body.crm_company_id === "string"
      ? body.crm_company_id.trim()
      : "";
    if (!crmCompanyId) {
      return safeJsonError("crm_company_id is required", 400, origin);
    }
    const lineItems = sanitizeLineItems(body.line_items);
    if (lineItems.length === 0) {
      return safeJsonError(
        "line_items must contain at least one part line",
        400,
        origin,
      );
    }

    const srcRaw = typeof body.order_source === "string"
      ? body.order_source.trim()
      : "counter";
    const orderSource =
      ["counter", "phone", "email", "online", "transfer"].includes(srcRaw)
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

    let pricedLineRows: Array<Record<string, unknown>>;
    try {
      pricedLineRows = await resolveOrderLineRows(
        supabase,
        lineItems,
        crmCompanyId,
      );
    } catch (e) {
      const response = pricingErrorResponse(e, origin);
      if (response) return response;
      throw e;
    }
    const { subtotal, total } = totalsFromOrderLineRows(pricedLineRows);
    const notes = typeof body.notes === "string"
      ? body.notes.trim().slice(0, 4000)
      : null;
    const fleetId = typeof body.fleet_id === "string" && body.fleet_id.trim()
      ? body.fleet_id.trim()
      : null;
    let tenderPatch: Record<string, unknown>;
    try {
      tenderPatch = completeTenderPatch(
        normalizeCounterTenderInput(
          body as unknown as Record<string, unknown>,
          null,
        ),
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
      line_items: pricedLineRows,
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
    const lineRows = pricedLineRows.map((line) => ({
      parts_order_id: orderId,
      ...line,
    }));

    const { error: lineErr } = await supabase.from("parts_order_lines").insert(
      lineRows,
    );
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
    const orderId = typeof body.parts_order_id === "string"
      ? body.parts_order_id.trim()
      : "";
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
      return safeJsonError(
        "Internal submit requires crm_company_id on order",
        400,
        origin,
      );
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

    const { error: evErr } = await supabase.from("parts_fulfillment_events")
      .insert({
        workspace_id: row.workspace_id,
        fulfillment_run_id: run.id,
        event_type: "internal_order_submitted",
        payload: {
          parts_order_id: orderId,
          order_source: row.order_source ?? "counter",
          payment_classification: row.payment_classification ?? "cash",
          payment_status: row.payment_status ?? "unpaid",
          charge_authorization_status: row.charge_authorization_status ??
            "not_applicable",
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
        charge_authorization_status: row.charge_authorization_status ??
          "not_applicable",
      },
    });

    return safeJsonOk({ order: updated, fulfillment_run_id: run.id }, origin);
  }

  // ── UPDATE ORDER FIELDS ─────────────────────────────────────────────
  if (action === "update_internal_order") {
    const orderId = typeof body.parts_order_id === "string"
      ? body.parts_order_id.trim()
      : "";
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
    if (typeof body.notes === "string") {
      patch.notes = body.notes.trim().slice(0, 4000);
    }
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
            normalizeCounterTenderInput(
              body as unknown as Record<string, unknown>,
              row,
            ),
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
      workspaceId:
        (updated as Record<string, unknown>)?.workspace_id as string ??
          "default",
      orderId,
      eventType: "fields_updated",
      actorId: userId,
      metadata: { updated_fields: Object.keys(patch) },
    });

    return safeJsonOk({ order: updated }, origin);
  }

  // ── UPDATE ORDER LINES ──────────────────────────────────────────────
  if (action === "update_order_lines") {
    const orderId = typeof body.parts_order_id === "string"
      ? body.parts_order_id.trim()
      : "";
    if (!orderId) {
      return safeJsonError("parts_order_id is required", 400, origin);
    }

    const { data: row, error: fetchErr } = await supabase
      .from("parts_orders")
      .select(
        "id, status, workspace_id, crm_company_id, order_source, payment_classification, payment_status, charge_authorization_status",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (fetchErr || !row) {
      return safeJsonError("Order not found", 404, origin);
    }
    if (row.status !== "draft") {
      return safeJsonError(
        "Lines can only be updated on draft orders",
        400,
        origin,
      );
    }

    const lineItems = sanitizeLineItems(body.line_items);
    if (lineItems.length === 0) {
      return safeJsonError(
        "line_items must contain at least one part line",
        400,
        origin,
      );
    }
    if (!row.crm_company_id) {
      return safeJsonError(
        "Order lines require crm_company_id for parts pricing",
        400,
        origin,
      );
    }

    let pricedLineRows: Array<Record<string, unknown>>;
    try {
      pricedLineRows = await resolveOrderLineRows(
        supabase,
        lineItems,
        String(row.crm_company_id),
      );
    } catch (e) {
      const response = pricingErrorResponse(e, origin);
      if (response) return response;
      throw e;
    }

    const { data: existingLines, error: existingErr } = await supabase
      .from("parts_order_lines")
      .select("*")
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

    const lineRows = pricedLineRows.map((line) => ({
      parts_order_id: orderId,
      ...line,
    }));

    const { error: insErr } = await supabase.from("parts_order_lines").insert(
      lineRows,
    );
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

    const { subtotal, total } = totalsFromOrderLineRows(pricedLineRows);
    const { error: upErr } = await supabase
      .from("parts_orders")
      .update({ line_items: pricedLineRows, subtotal, total })
      .eq("id", orderId);
    if (upErr) {
      console.error("parts-order-manager sync totals:", upErr);
      await supabase.from("parts_order_lines").delete().eq(
        "parts_order_id",
        orderId,
      );
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
    const orderId = typeof body.parts_order_id === "string"
      ? body.parts_order_id.trim()
      : "";
    const newStatus = typeof body.new_status === "string"
      ? body.new_status.trim()
      : "";

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
      if (
        typeof body.tracking_number === "string" && body.tracking_number.trim()
      ) {
        patch.tracking_number = body.tracking_number.trim();
      }
      if (
        typeof body.estimated_delivery === "string" &&
        body.estimated_delivery.trim()
      ) {
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

    // M2.1: the delivered transition is the parts order-to-cash moment —
    // write the customer_invoices + parts_invoice_lines rows. Zero-blocking:
    // a failed invoice never rolls back the delivered status; it dead-letters
    // to exception_queue('parts_billing_failed') for the finance desk.
    let invoiceSummary: Record<string, unknown> | null = null;
    if (newStatus === "delivered") {
      try {
        // The role gate (requireServiceUser + SERVICE_PARTS_ROLES) already
        // authorized this transition; the invoice writer needs a true
        // service client because quickbooks_gl_sync_jobs and flow_events
        // are service-role-write-only under RLS.
        const invoiceAdmin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { persistSession: false } },
        );
        const result = await generateInvoiceForPartsOrder(invoiceAdmin, orderId);
        invoiceSummary = result as unknown as Record<string, unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("parts-order-manager invoice generation:", message);
        invoiceSummary = { status: "failed", error: message };
        await supabase.rpc("enqueue_exception", {
          p_source: "parts_billing_failed",
          p_title: `Parts invoicing failed for order ${orderId}`.slice(0, 200),
          p_severity: "error",
          p_detail: message.slice(0, 1000),
          p_payload: { parts_order_id: orderId },
          p_entity_table: "parts_orders",
          p_entity_id: orderId,
        });
      }
    }

    return safeJsonOk({ order: updated, invoice: invoiceSummary }, origin);
  }

  // ── PICK ORDER LINE ─────────────────────────────────────────────────
  if (action === "pick_order_line") {
    const orderId = typeof body.parts_order_id === "string"
      ? body.parts_order_id.trim()
      : "";
    const lineId = typeof body.parts_order_line_id === "string"
      ? body.parts_order_line_id.trim()
      : "";
    const branchId = typeof body.branch_id === "string"
      ? body.branch_id.trim()
      : "";

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
      return safeJsonError(
        "Pick requires whole-number quantities",
        400,
        origin,
      );
    }

    const { error: rpcErr } = await supabase.rpc(
      "adjust_parts_inventory_delta_strict",
      {
        p_workspace_id: order.workspace_id,
        p_branch_id: branchId,
        p_part_number: line.part_number,
        p_delta: -line.quantity,
      },
    );

    if (rpcErr) {
      console.error("parts-order-manager pick rpc:", rpcErr);
      return safeJsonError(
        rpcErr.message ?? "Inventory pick failed (insufficient stock?)",
        400,
        origin,
      );
    }

    if (order.status === "confirmed") {
      await supabase.from("parts_orders").update({ status: "processing" }).eq(
        "id",
        orderId,
      );
    }

    const { data: run } = await supabase
      .from("parts_orders")
      .select("fulfillment_run_id")
      .eq("id", orderId)
      .maybeSingle();

    if (run?.fulfillment_run_id) {
      const { error: evErr } = await supabase.from("parts_fulfillment_events")
        .insert({
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
      picked: {
        line_id: lineId,
        part_number: line.part_number,
        quantity: line.quantity,
        branch_id: branchId,
      },
    }, origin);
  }

  // ── RESERVE INTER-BRANCH TRANSFER ───────────────────────────────────
  if (action === "reserve_interbranch_transfer") {
    const partId = typeof body.part_id === "string" ? body.part_id.trim() : "";
    const fromLocationId = typeof body.from_location_id === "string"
      ? body.from_location_id.trim()
      : "";
    const toLocationId = typeof body.to_location_id === "string"
      ? body.to_location_id.trim()
      : "";
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
      return safeJsonError(
        "customer_choice must be transfer or oem_order",
        400,
        origin,
      );
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
    const customerId = typeof body.customer_id === "string"
      ? body.customer_id.trim()
      : "";
    const contactId =
      typeof body.contact_id === "string" && body.contact_id.trim()
        ? body.contact_id.trim()
        : null;
    const quoteSourceRaw = typeof body.quote_source === "string"
      ? body.quote_source.trim()
      : "phone";
    const quoteSource =
      ["counter", "phone", "email", "walkin", "service", "online"].includes(
          quoteSourceRaw,
        )
        ? quoteSourceRaw
        : "phone";
    const freightEstimateCents = Math.max(
      0,
      Math.floor(num(body.freight_estimate_cents) ?? 0),
    );
    const freightSourceRaw = typeof body.freight_estimate_source === "string"
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
    const notes = typeof body.notes === "string"
      ? body.notes.trim().slice(0, 4000)
      : null;
    const description = typeof body.notes === "string"
      ? body.notes.trim().slice(0, 500)
      : null;
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

    let pricedQuoteLines: Array<Record<string, unknown>>;
    try {
      pricedQuoteLines = await resolveQuoteLineRows(
        supabase,
        quoteLines,
        customerId,
      );
    } catch (e) {
      const response = pricingErrorResponse(e, origin);
      if (response) return response;
      throw e;
    }

    const subtotalCents = pricedQuoteLines.reduce(
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

    const lineRows = pricedQuoteLines.map((line) => ({
      workspace_id: workspaceId,
      parts_quote_id: quote.id,
      ...line,
    }));

    const { error: linesErr } = await supabase.from("parts_quote_lines").insert(
      lineRows,
    );
    if (linesErr) {
      console.error("parts-order-manager quote lines:", linesErr);
      await supabase.from("parts_quotes").delete().eq("id", quote.id);
      return safeJsonError("Failed to create parts quote lines", 500, origin);
    }

    return safeJsonOk({ quote, lines: lineRows.length }, origin, 201);
  }

  // ── CONVERT PARTS QUOTE TO ORDER ────────────────────────────────────
  if (action === "convert_parts_quote_to_order") {
    const quoteId = typeof body.parts_quote_id === "string"
      ? body.parts_quote_id.trim()
      : "";
    const crmCompanyId = typeof body.crm_company_id === "string"
      ? body.crm_company_id.trim()
      : "";
    const orderSource =
      typeof body.order_source === "string" && body.order_source.trim()
        ? body.order_source.trim()
        : null;
    const paymentClassification =
      typeof body.payment_classification === "string" &&
        body.payment_classification.trim()
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

  // ── DECIDE OVER-CAP LINE DISCOUNT ──────────────────────────────────
  if (action === "decide_line_discount") {
    if (!["admin", "manager", "owner"].includes(userRole)) {
      return safeJsonError("Parts Manager approval role required", 403, origin);
    }

    const lineType = typeof body.line_type === "string"
      ? body.line_type.trim()
      : "";
    const lineId = typeof body.line_id === "string" ? body.line_id.trim() : "";
    const decision = typeof body.discount_decision === "string"
      ? body.discount_decision.trim()
      : "";
    const reason = typeof body.discount_reason === "string"
      ? body.discount_reason.trim().slice(0, 500)
      : null;

    if (!lineType || !lineId || !decision) {
      return safeJsonError(
        "line_type, line_id, and discount_decision are required",
        400,
        origin,
      );
    }

    const { data: result, error: decideErr } = await supabase.rpc(
      "parts_decide_line_discount",
      {
        p_line_type: lineType,
        p_line_id: lineId,
        p_decision: decision,
        p_reason: reason,
      },
    );

    if (decideErr) {
      console.error("parts-order-manager decide discount:", decideErr);
      return safeJsonError(
        decideErr.message ?? "Failed to decide line discount",
        400,
        origin,
      );
    }

    return safeJsonOk({ result }, origin);
  }

  return safeJsonError(`Unknown action: ${String(action)}`, 400, origin);
});
