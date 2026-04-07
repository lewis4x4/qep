/**
 * QEP Flow Engine — Iron Companion actions (Wave 7).
 *
 * These are the side-effect handlers for Iron-driven conversational flows.
 * Each action mirrors a manual operator workflow that already exists in
 * the QEP repo (parts-order-manager, crm forms, service intake, etc.) but
 * expects fully-resolved slot data from the Iron flow engine.
 *
 * Conventions match supabase/functions/_shared/flow-engine/registry.ts:
 *   • Each action declares an idempotency_key_template using slot refs
 *   • Each action respects deps.dry_run (Iron sandbox mode)
 *   • Returns FlowActionResult with a result blob the runner persists
 *
 * Iron actions resolve slots from `ctx.event.properties.slots`, NOT from
 * the workflow's static `params`. The orchestrator emits an event with
 * the user's slot fills as the payload, so the action just walks
 * `ctx.event.properties.slots`.
 */
import type { FlowAction, FlowActionDeps, FlowActionResult, FlowContext } from "./types.ts";

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function slots(ctx: FlowContext): Record<string, unknown> {
  const props = (ctx.event.properties ?? {}) as Record<string, unknown>;
  const s = props.slots;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
}

function dryRunSkip(key: string): FlowActionResult {
  return { status: "skipped", reason: `dry_run for ${key}` };
}

function num(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function str(x: unknown, max = 500): string | null {
  if (x == null) return null;
  const s = String(x).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/* ─── 1. iron_pull_part ─────────────────────────────────────────────────── */
//
// Slots:
//   crm_company_id (required)
//   line_items (required, array of { part_number, description?, quantity, unit_price? })
//   notes (optional)
//   order_source (optional, default 'counter')
//   fleet_id (optional)
//
// Result: { entity_type: 'parts_order', entity_id, line_count, total_cents }

const iron_pull_part: FlowAction = {
  key: "iron_pull_part",
  description: "Iron flagship: create a counter parts order from voice/conversational slot fill",
  affects_modules: ["parts"],
  idempotency_key_template: "iron_pull_part:${event.entity_id}:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_pull_part");

    const s = slots(ctx);
    const crmCompanyId = str(s.crm_company_id, 64);
    if (!crmCompanyId) {
      return { status: "failed", error: "iron_pull_part: crm_company_id slot missing", retryable: false };
    }

    const rawLines = Array.isArray(s.line_items) ? s.line_items : [];
    const lineItems: Array<Record<string, unknown>> = [];
    for (const raw of rawLines) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const partNumber = str(r.part_number, 120);
      if (!partNumber) continue;
      const quantity = Math.max(1, Math.min(99_999, Math.floor(num(r.quantity) ?? 1)));
      const unitPrice = num(r.unit_price);
      const line: Record<string, unknown> = {
        part_number: partNumber,
        description: str(r.description, 500),
        quantity,
        is_ai_suggested: false,
      };
      if (unitPrice != null && unitPrice >= 0) {
        line.unit_price = Math.round(unitPrice * 10000) / 10000;
      }
      lineItems.push(line);
    }
    if (lineItems.length === 0) {
      return { status: "failed", error: "iron_pull_part: no valid line_items", retryable: false };
    }
    if (lineItems.length > 200) {
      return { status: "failed", error: "iron_pull_part: too many line items", retryable: false };
    }

    // Resolve workspace from the company row (matches parts-order-manager pattern)
    const { data: company, error: companyErr } = await deps.admin
      .from("crm_companies")
      .select("id, workspace_id")
      .eq("id", crmCompanyId)
      .maybeSingle();
    if (companyErr) {
      return { status: "failed", error: `iron_pull_part: company lookup failed: ${companyErr.message}`, retryable: true };
    }
    if (!company?.id) {
      return { status: "failed", error: "iron_pull_part: company not found", retryable: false };
    }

    // Compute totals
    let subtotal = 0;
    for (const line of lineItems) {
      const q = Number(line.quantity) || 1;
      const up = num(line.unit_price);
      if (up != null) subtotal += up * q;
    }

    const orderSourceRaw = str(s.order_source, 16) ?? "counter";
    const orderSource = ["counter", "phone", "online", "transfer"].includes(orderSourceRaw)
      ? orderSourceRaw
      : "counter";

    // Insert order header
    const { data: order, error: insErr } = await deps.admin
      .from("parts_orders")
      .insert({
        workspace_id: company.workspace_id,
        status: "draft",
        portal_customer_id: null,
        crm_company_id: crmCompanyId,
        order_source: orderSource,
        notes: str(s.notes, 4000),
        fleet_id: str(s.fleet_id, 64),
        line_items: lineItems,
        subtotal,
        tax: 0,
        shipping: 0,
        total: subtotal,
      })
      .select("id, workspace_id")
      .single();

    if (insErr || !order?.id) {
      return { status: "failed", error: `iron_pull_part: insert failed: ${insErr?.message ?? "unknown"}`, retryable: true };
    }

    const orderId = order.id as string;

    // Insert structured line rows (counter sale path uses parts_order_lines too)
    const lineRows = lineItems.map((line, idx) => ({
      parts_order_id: orderId,
      workspace_id: company.workspace_id,
      part_number: String(line.part_number),
      description: line.description as string | null,
      quantity: Number(line.quantity) || 1,
      unit_price: line.unit_price != null ? Number(line.unit_price) : null,
      line_total: line.unit_price != null
        ? Number(line.unit_price) * (Number(line.quantity) || 1)
        : null,
      sort_order: idx,
    }));

    const { error: linesErr } = await deps.admin.from("parts_order_lines").insert(lineRows);
    if (linesErr) {
      // Compensate header insert
      await deps.admin.from("parts_orders").delete().eq("id", orderId);
      return { status: "failed", error: `iron_pull_part: line insert failed: ${linesErr.message}`, retryable: true };
    }

    // Append a creation event so the order timeline matches the manual path
    try {
      await deps.admin.from("parts_order_events").insert({
        workspace_id: company.workspace_id,
        parts_order_id: orderId,
        event_type: "created",
        source: "system",
        from_status: null,
        to_status: "draft",
        metadata: {
          via: "iron",
          flow_run_id: deps.run_id,
          line_count: lineRows.length,
        },
      });
    } catch (err) {
      console.warn("[iron_pull_part] event insert (non-blocking):", (err as Error).message);
    }

    return {
      status: "succeeded",
      result: {
        entity_type: "parts_order",
        entity_id: orderId,
        line_count: lineRows.length,
        total_cents: Math.round(subtotal * 100),
      },
    };
  },
};

/* ─── 2. iron_add_customer ──────────────────────────────────────────────── */

const iron_add_customer: FlowAction = {
  key: "iron_add_customer",
  description: "Iron: create a new CRM contact (and optionally link a company)",
  affects_modules: ["qrm"],
  idempotency_key_template: "iron_add_customer:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_add_customer");

    const s = slots(ctx);
    const firstName = str(s.first_name, 120);
    const lastName = str(s.last_name, 120);
    if (!firstName || !lastName) {
      return { status: "failed", error: "iron_add_customer: first_name + last_name required", retryable: false };
    }

    const insertRow: Record<string, unknown> = {
      workspace_id: deps.workspace_id,
      first_name: firstName,
      last_name: lastName,
      email: str(s.email, 254),
      phone: str(s.phone, 32),
      title: str(s.title, 120),
      primary_company_id: str(s.company_id, 64),
    };

    const { data, error } = await deps.admin
      .from("crm_contacts")
      .insert(insertRow)
      .select("id")
      .single();
    if (error || !data?.id) {
      return { status: "failed", error: `iron_add_customer: ${error?.message ?? "unknown"}`, retryable: true };
    }

    return {
      status: "succeeded",
      result: { entity_type: "crm_contact", entity_id: data.id },
    };
  },
};

/* ─── 3. iron_add_equipment ─────────────────────────────────────────────── */

const iron_add_equipment: FlowAction = {
  key: "iron_add_equipment",
  description: "Iron: create a new equipment record in crm_equipment",
  affects_modules: ["qrm"],
  idempotency_key_template: "iron_add_equipment:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_add_equipment");

    const s = slots(ctx);
    const make = str(s.make, 120);
    const model = str(s.model, 120);
    if (!make || !model) {
      return { status: "failed", error: "iron_add_equipment: make + model required", retryable: false };
    }

    const insertRow: Record<string, unknown> = {
      workspace_id: deps.workspace_id,
      make,
      model,
      year: num(s.year),
      serial_number: str(s.serial_number, 120),
      stock_number: str(s.stock_number, 120),
      hours: num(s.hours),
      condition: str(s.condition, 32),
      company_id: str(s.company_id, 64),
    };

    const { data, error } = await deps.admin
      .from("crm_equipment")
      .insert(insertRow)
      .select("id")
      .single();
    if (error || !data?.id) {
      return { status: "failed", error: `iron_add_equipment: ${error?.message ?? "unknown"}`, retryable: true };
    }

    return {
      status: "succeeded",
      result: { entity_type: "crm_equipment", entity_id: data.id },
    };
  },
};

/* ─── 4. iron_log_service_call ──────────────────────────────────────────── */
//
// Schema references (from migration 094):
//   service_jobs.customer_id uuid references crm_companies(id)   — a COMPANY id
//   service_jobs.contact_id uuid references crm_contacts(id)     — optional contact
//   service_jobs.machine_id uuid references crm_equipment(id)    — the asset
//   service_jobs.customer_problem_summary text                   — the complaint
//   service_jobs.priority public.service_priority enum           — normal|urgent|critical
//   service_jobs.current_stage public.service_stage enum         — defaults to request_received
//
// The slot schema in iron-flows.ts matches these names; the v1.0 action had
// the wrong column names (equipment_id, complaint, status) which would fail
// at insert on any real deployment.

const VALID_SERVICE_PRIORITIES = new Set(["normal", "urgent", "critical"]);

const iron_log_service_call: FlowAction = {
  key: "iron_log_service_call",
  description: "Iron: create a new service job entry from a field call",
  affects_modules: ["service"],
  idempotency_key_template: "iron_log_service_call:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_log_service_call");

    const s = slots(ctx);
    const customerId = str(s.customer_id, 64);
    const description = str(s.description, 4000);
    if (!customerId) {
      return { status: "failed", error: "iron_log_service_call: customer_id required", retryable: false };
    }
    if (!description) {
      return { status: "failed", error: "iron_log_service_call: description required", retryable: false };
    }

    // Clamp priority to the valid enum set; fall back to column default by
    // omitting the field entirely if the slot is missing/invalid.
    const rawPriority = str(s.priority, 16);
    const priority = rawPriority && VALID_SERVICE_PRIORITIES.has(rawPriority) ? rawPriority : null;

    const insertRow: Record<string, unknown> = {
      workspace_id: deps.workspace_id,
      customer_id: customerId,                       // → crm_companies
      contact_id: str(s.contact_id, 64),             // optional → crm_contacts
      machine_id: str(s.equipment_id, 64),           // optional → crm_equipment
      customer_problem_summary: description,
      // current_stage intentionally omitted so the column default
      // ('request_received') applies.
    };
    if (priority) insertRow.priority = priority;

    const { data, error } = await deps.admin
      .from("service_jobs")
      .insert(insertRow)
      .select("id")
      .single();
    if (error || !data?.id) {
      return { status: "failed", error: `iron_log_service_call: ${error?.message ?? "unknown"}`, retryable: true };
    }

    return {
      status: "succeeded",
      result: { entity_type: "service_job", entity_id: data.id },
    };
  },
};

/* ─── 5. iron_draft_email ───────────────────────────────────────────────── */
//
// Reuses the email_drafts table; safer than send_email_draft because Iron
// flows want to attach the iron run id directly.

const iron_draft_email: FlowAction = {
  key: "iron_draft_email",
  description: "Iron: create an email draft awaiting operator review (never sent)",
  affects_modules: ["communications", "qrm"],
  idempotency_key_template: "iron_draft_email:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_draft_email");

    const s = slots(ctx);
    const toEmail = str(s.to_email, 254);
    const subject = str(s.subject, 500);
    const body = str(s.body, 20000);
    if (!toEmail || !subject || !body) {
      return { status: "failed", error: "iron_draft_email: to_email, subject, body required", retryable: false };
    }

    const { data, error } = await deps.admin
      .from("email_drafts")
      .insert({
        workspace_id: deps.workspace_id,
        to_email: toEmail,
        subject,
        body,
        related_entity_type: str(s.related_entity_type, 64),
        related_entity_id: str(s.related_entity_id, 64),
        created_by_workflow: deps.run_id,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.message?.includes("does not exist")) {
        return { status: "skipped", reason: "email_drafts table not provisioned" };
      }
      return { status: "failed", error: `iron_draft_email: ${error.message}`, retryable: true };
    }

    return {
      status: "succeeded",
      result: { entity_type: "email_draft", entity_id: data?.id ?? null },
    };
  },
};

/* ─── 6. iron_initiate_rental_return ────────────────────────────────────── */
//
// Backed by the existing rental_returns table (migration 079). Iron starts
// the inspection step; the rest of the lifecycle is handled by existing UI.

const iron_initiate_rental_return: FlowAction = {
  key: "iron_initiate_rental_return",
  description: "Iron: open a rental return inspection record",
  affects_modules: ["rental"],
  idempotency_key_template: "iron_init_rental_return:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_initiate_rental_return");

    const s = slots(ctx);
    const equipmentId = str(s.equipment_id, 64);
    const inspectorId = str(s.inspector_id, 64);
    if (!equipmentId) {
      return { status: "failed", error: "iron_initiate_rental_return: equipment_id required", retryable: false };
    }

    const { data, error } = await deps.admin
      .from("rental_returns")
      .insert({
        workspace_id: deps.workspace_id,
        equipment_id: equipmentId,
        inspector_id: inspectorId,
        inspection_date: new Date().toISOString().slice(0, 10),
        status: "inspection_pending",
      })
      .select("id")
      .single();
    if (error || !data?.id) {
      return { status: "failed", error: `iron_initiate_rental_return: ${error?.message ?? "unknown"}`, retryable: true };
    }

    return {
      status: "succeeded",
      result: { entity_type: "rental_return", entity_id: data.id },
    };
  },
};

/* ─── Registry export ───────────────────────────────────────────────────── */

export const IRON_ACTION_REGISTRY: Record<string, FlowAction> = {
  iron_pull_part,
  iron_add_customer,
  iron_add_equipment,
  iron_log_service_call,
  iron_draft_email,
  iron_initiate_rental_return,
};
