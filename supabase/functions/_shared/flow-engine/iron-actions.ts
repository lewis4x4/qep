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
import type {
  FlowAction,
  FlowActionDeps,
  FlowActionResult,
  FlowContext,
} from "./types.ts";

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

const DEFAULT_FOLLOW_UP_HOUR_UTC = 14;
const WEEKDAYS = new Map([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
]);

function withDefaultFollowUpTime(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(DEFAULT_FOLLOW_UP_HOUR_UTC, 0, 0, 0);
  return next;
}

function applyTimeIfPresent(date: Date, raw: string): Date {
  const match = raw.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return date;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = match[3].toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return date;

  const next = new Date(date);
  next.setUTCHours(hour, minute, 0, 0);
  return next;
}

export function parseIronFollowUpAt(
  raw: unknown,
  now: Date = new Date(),
): string | null {
  const text = str(raw, 120);
  if (!text) return null;

  const lower = text.toLowerCase();
  let candidate: Date | null = null;

  if (/\btoday\b/.test(lower)) {
    candidate = withDefaultFollowUpTime(now);
  } else if (/\btomorrow\b/.test(lower)) {
    candidate = withDefaultFollowUpTime(new Date(now.getTime() + 86_400_000));
  } else {
    const inDays = lower.match(/\bin\s+(\d{1,2})\s+days?\b/);
    if (inDays) {
      candidate = withDefaultFollowUpTime(
        new Date(now.getTime() + Number(inDays[1]) * 86_400_000),
      );
    }
  }

  if (!candidate && /\bnext\s+week\b/.test(lower)) {
    candidate = withDefaultFollowUpTime(
      new Date(now.getTime() + 7 * 86_400_000),
    );
  }

  if (!candidate) {
    for (const [name, day] of WEEKDAYS) {
      if (!new RegExp(`\\b(?:next\\s+)?${name}\\b`).test(lower)) continue;
      const current = now.getUTCDay();
      let delta = (day - current + 7) % 7;
      if (delta === 0) delta += 7;
      candidate = withDefaultFollowUpTime(
        new Date(now.getTime() + delta * 86_400_000),
      );
      break;
    }
  }

  if (!candidate) {
    const dateOnly = lower.match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/);
    if (dateOnly) {
      candidate = withDefaultFollowUpTime(
        new Date(
          Date.UTC(
            Number(dateOnly[1]),
            Number(dateOnly[2]) - 1,
            Number(dateOnly[3]),
          ),
        ),
      );
    }
  }

  if (!candidate) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) candidate = new Date(parsed);
  }

  if (!candidate || Number.isNaN(candidate.getTime())) return null;
  candidate = applyTimeIfPresent(candidate, lower);
  return candidate.toISOString();
}

const FOLLOW_UP_CHANNELS = new Set([
  "call",
  "email",
  "text",
  "visit",
  "voice_note",
]);

function normalizeFollowUpChannel(raw: unknown): string {
  const value = str(raw, 32) ?? "call";
  return FOLLOW_UP_CHANNELS.has(value) ? value : "call";
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
  description:
    "Iron flagship: create a counter parts order from voice/conversational slot fill",
  affects_modules: ["parts"],
  idempotency_key_template:
    "iron_pull_part:${event.entity_id}:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_pull_part");

    const s = slots(ctx);
    const crmCompanyId = str(s.crm_company_id, 64);
    if (!crmCompanyId) {
      return {
        status: "failed",
        error: "iron_pull_part: crm_company_id slot missing",
        retryable: false,
      };
    }

    const rawLines = Array.isArray(s.line_items) ? s.line_items : [];
    const lineItems: Array<Record<string, unknown>> = [];
    for (const raw of rawLines) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const partNumber = str(r.part_number, 120);
      if (!partNumber) continue;
      const quantity = Math.max(
        1,
        Math.min(99_999, Math.floor(num(r.quantity) ?? 1)),
      );
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
      return {
        status: "failed",
        error: "iron_pull_part: no valid line_items",
        retryable: false,
      };
    }
    if (lineItems.length > 200) {
      return {
        status: "failed",
        error: "iron_pull_part: too many line items",
        retryable: false,
      };
    }

    // Resolve the company inside the caller workspace. This action runs with the
    // service-role client, so every entity id from slots must be explicitly
    // scoped before any writes happen.
    const { data: company, error: companyErr } = await deps.admin
      .from("crm_companies")
      .select("id, workspace_id")
      .eq("id", crmCompanyId)
      .eq("workspace_id", deps.workspace_id)
      .maybeSingle();
    if (companyErr) {
      return {
        status: "failed",
        error: `iron_pull_part: company lookup failed: ${companyErr.message}`,
        retryable: true,
      };
    }
    if (!company?.id) {
      return {
        status: "failed",
        error: "iron_pull_part: company not found",
        retryable: false,
      };
    }

    // Compute totals
    let subtotal = 0;
    for (const line of lineItems) {
      const q = Number(line.quantity) || 1;
      const up = num(line.unit_price);
      if (up != null) subtotal += up * q;
    }

    const orderSourceRaw = str(s.order_source, 16) ?? "counter";
    const orderSource =
      ["counter", "phone", "online", "transfer"].includes(orderSourceRaw)
        ? orderSourceRaw
        : "counter";

    // Insert order header
    const { data: order, error: insErr } = await deps.admin
      .from("parts_orders")
      .insert({
        workspace_id: deps.workspace_id,
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
      return {
        status: "failed",
        error: `iron_pull_part: insert failed: ${insErr?.message ?? "unknown"}`,
        retryable: true,
      };
    }

    const orderId = order.id as string;

    // Insert structured line rows (counter sale path uses parts_order_lines too)
    const lineRows = lineItems.map((line, idx) => ({
      parts_order_id: orderId,
      workspace_id: deps.workspace_id,
      part_number: String(line.part_number),
      description: line.description as string | null,
      quantity: Number(line.quantity) || 1,
      unit_price: line.unit_price != null ? Number(line.unit_price) : null,
      line_total: line.unit_price != null
        ? Number(line.unit_price) * (Number(line.quantity) || 1)
        : null,
      sort_order: idx,
    }));

    const { error: linesErr } = await deps.admin.from("parts_order_lines")
      .insert(lineRows);
    if (linesErr) {
      // Compensate header insert
      await deps.admin.from("parts_orders").delete().eq("id", orderId);
      return {
        status: "failed",
        error: `iron_pull_part: line insert failed: ${linesErr.message}`,
        retryable: true,
      };
    }

    // Append a creation event so the order timeline matches the manual path
    try {
      await deps.admin.from("parts_order_events").insert({
        workspace_id: deps.workspace_id,
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
      console.warn(
        "[iron_pull_part] event insert (non-blocking):",
        (err as Error).message,
      );
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
      return {
        status: "failed",
        error: "iron_add_customer: first_name + last_name required",
        retryable: false,
      };
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
      return {
        status: "failed",
        error: `iron_add_customer: ${error?.message ?? "unknown"}`,
        retryable: true,
      };
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
      return {
        status: "failed",
        error: "iron_add_equipment: make + model required",
        retryable: false,
      };
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
      return {
        status: "failed",
        error: `iron_add_equipment: ${error?.message ?? "unknown"}`,
        retryable: true,
      };
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
      return {
        status: "failed",
        error: "iron_log_service_call: customer_id required",
        retryable: false,
      };
    }
    if (!description) {
      return {
        status: "failed",
        error: "iron_log_service_call: description required",
        retryable: false,
      };
    }

    // Clamp priority to the valid enum set; fall back to column default by
    // omitting the field entirely if the slot is missing/invalid.
    const rawPriority = str(s.priority, 16);
    const priority = rawPriority && VALID_SERVICE_PRIORITIES.has(rawPriority)
      ? rawPriority
      : null;

    const insertRow: Record<string, unknown> = {
      workspace_id: deps.workspace_id,
      customer_id: customerId, // → crm_companies
      contact_id: str(s.contact_id, 64), // optional → crm_contacts
      machine_id: str(s.equipment_id, 64), // optional → crm_equipment
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
      return {
        status: "failed",
        error: `iron_log_service_call: ${error?.message ?? "unknown"}`,
        retryable: true,
      };
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
  description:
    "Iron: create an email draft awaiting operator review (never sent)",
  affects_modules: ["communications", "qrm"],
  idempotency_key_template: "iron_draft_email:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_draft_email");

    const s = slots(ctx);
    const toEmail = str(s.to_email, 254);
    const subject = str(s.subject, 500);
    const body = str(s.body, 20000);
    if (!toEmail || !subject || !body) {
      return {
        status: "failed",
        error: "iron_draft_email: to_email, subject, body required",
        retryable: false,
      };
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
        return {
          status: "skipped",
          reason: "email_drafts table not provisioned",
        };
      }
      return {
        status: "failed",
        error: `iron_draft_email: ${error.message}`,
        retryable: true,
      };
    }

    return {
      status: "succeeded",
      result: { entity_type: "email_draft", entity_id: data?.id ?? null },
    };
  },
};

/* ─── 6. iron_schedule_follow_up ───────────────────────────────────────── */

const iron_schedule_follow_up: FlowAction = {
  key: "iron_schedule_follow_up",
  description: "Iron: schedule the next CRM follow-up on an open deal",
  affects_modules: ["qrm", "sales"],
  idempotency_key_template: "iron_schedule_follow_up:${event.correlation_id}",
  async execute(_params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip("iron_schedule_follow_up");

    const s = slots(ctx);
    const dealId = str(s.deal_id, 64);
    const followUpAt = parseIronFollowUpAt(s.follow_up_at);
    const purpose = str(s.purpose, 2000);
    const channel = normalizeFollowUpChannel(s.channel);
    const userId = str(
      (ctx.event.properties as Record<string, unknown>).user_id,
      64,
    );

    if (!dealId) {
      return {
        status: "failed",
        error: "iron_schedule_follow_up: deal_id required",
        retryable: false,
      };
    }
    if (!followUpAt) {
      return {
        status: "failed",
        error: "iron_schedule_follow_up: follow_up_at could not be parsed",
        retryable: false,
      };
    }
    if (!purpose) {
      return {
        status: "failed",
        error: "iron_schedule_follow_up: purpose required",
        retryable: false,
      };
    }

    const { data: deal, error: dealErr } = await deps.admin
      .from("crm_deals")
      .select(
        "id, workspace_id, name, assigned_rep_id, next_follow_up_at, deleted_at, closed_at",
      )
      .eq("id", dealId)
      .eq("workspace_id", deps.workspace_id)
      .maybeSingle();

    if (dealErr) {
      return {
        status: "failed",
        error:
          `iron_schedule_follow_up: deal lookup failed: ${dealErr.message}`,
        retryable: true,
      };
    }
    if (!deal?.id) {
      return {
        status: "failed",
        error: "iron_schedule_follow_up: deal not found",
        retryable: false,
      };
    }
    if (deal.deleted_at || deal.closed_at) {
      return {
        status: "failed",
        error: "iron_schedule_follow_up: deal is closed or deleted",
        retryable: false,
      };
    }

    const assignedUserId = str(deal.assigned_rep_id, 64) ?? userId;
    if (!assignedUserId) {
      return {
        status: "failed",
        error: "iron_schedule_follow_up: no assigned user available",
        retryable: false,
      };
    }

    const previousNextFollowUpAt = str(deal.next_follow_up_at, 64);

    const { error: updateErr } = await deps.admin
      .from("crm_deals")
      .update({
        next_follow_up_at: followUpAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dealId)
      .eq("workspace_id", deps.workspace_id);
    if (updateErr) {
      return {
        status: "failed",
        error:
          `iron_schedule_follow_up: deal update failed: ${updateErr.message}`,
        retryable: true,
      };
    }

    const { data: existingReminders } = await deps.admin
      .from("crm_reminder_instances")
      .select("id, task_activity_id")
      .eq("workspace_id", deps.workspace_id)
      .eq("deal_id", dealId)
      .eq("status", "scheduled")
      .is("deleted_at", null);

    for (const reminder of existingReminders ?? []) {
      await deps.admin
        .from("crm_reminder_instances")
        .update({ status: "superseded", updated_at: new Date().toISOString() })
        .eq("id", reminder.id)
        .eq("workspace_id", deps.workspace_id);

      if (reminder.task_activity_id) {
        const { data: activityRow } = await deps.admin
          .from("crm_activities")
          .select("metadata")
          .eq("id", reminder.task_activity_id)
          .eq("workspace_id", deps.workspace_id)
          .maybeSingle();
        const existingMetadata =
          activityRow?.metadata && typeof activityRow.metadata === "object"
            ? activityRow.metadata as Record<string, unknown>
            : {};
        const existingTask =
          existingMetadata.task && typeof existingMetadata.task === "object"
            ? existingMetadata.task as Record<string, unknown>
            : {};
        const existingReminder = existingMetadata.follow_up_reminder &&
            typeof existingMetadata.follow_up_reminder === "object"
          ? existingMetadata.follow_up_reminder as Record<string, unknown>
          : {};
        await deps.admin
          .from("crm_activities")
          .update({
            metadata: {
              ...existingMetadata,
              task: {
                ...existingTask,
                status: "completed",
                supersededBy: "iron_schedule_follow_up",
              },
              follow_up_reminder: {
                ...existingReminder,
                supersededReminderId: reminder.id,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", reminder.task_activity_id)
          .eq("workspace_id", deps.workspace_id);
      }
    }

    const idempotencyKey = `${dealId}:${Date.parse(followUpAt)}:${deps.run_id}`;
    const { data: reminder, error: reminderErr } = await deps.admin
      .from("crm_reminder_instances")
      .insert({
        workspace_id: deps.workspace_id,
        deal_id: dealId,
        assigned_user_id: assignedUserId,
        due_at: followUpAt,
        status: "scheduled",
        source: "voice",
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();

    if (reminderErr || !reminder?.id) {
      await deps.admin
        .from("crm_deals")
        .update({
          next_follow_up_at: previousNextFollowUpAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dealId)
        .eq("workspace_id", deps.workspace_id);
      return {
        status: "failed",
        error: `iron_schedule_follow_up: reminder insert failed: ${
          reminderErr?.message ?? "unknown"
        }`,
        retryable: true,
      };
    }

    const reminderId = reminder.id as string;
    const taskBody = `Follow up via ${channel}: ${purpose}`;
    const { data: activity, error: activityErr } = await deps.admin
      .from("crm_activities")
      .insert({
        workspace_id: deps.workspace_id,
        activity_type: "task",
        body: taskBody,
        occurred_at: new Date().toISOString(),
        deal_id: dealId,
        created_by: userId,
        metadata: {
          task: {
            dueAt: followUpAt,
            status: "open",
            channel,
          },
          follow_up_reminder: {
            reminderId,
            source: "iron",
            purpose,
          },
          flow_run_id: deps.run_id,
        },
      })
      .select("id")
      .maybeSingle();

    if (activityErr) {
      await deps.admin
        .from("crm_reminder_instances")
        .update({ status: "superseded", updated_at: new Date().toISOString() })
        .eq("id", reminderId)
        .eq("workspace_id", deps.workspace_id);
      await deps.admin
        .from("crm_deals")
        .update({
          next_follow_up_at: previousNextFollowUpAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dealId)
        .eq("workspace_id", deps.workspace_id);
      return {
        status: "failed",
        error:
          `iron_schedule_follow_up: task insert failed: ${activityErr.message}`,
        retryable: true,
      };
    }

    const taskActivityId = (activity?.id as string | undefined) ?? null;
    if (taskActivityId) {
      await deps.admin
        .from("crm_reminder_instances")
        .update({
          task_activity_id: taskActivityId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reminderId)
        .eq("workspace_id", deps.workspace_id);
    }

    return {
      status: "succeeded",
      result: {
        entity_type: "crm_follow_up",
        entity_id: reminderId,
        deal_id: dealId,
        reminder_id: reminderId,
        task_activity_id: taskActivityId,
        follow_up_at: followUpAt,
        previous_next_follow_up_at: previousNextFollowUpAt,
        channel,
      },
    };
  },
};

/* ─── 7. iron_initiate_rental_return ────────────────────────────────────── */
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
      return {
        status: "failed",
        error: "iron_initiate_rental_return: equipment_id required",
        retryable: false,
      };
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
      return {
        status: "failed",
        error: `iron_initiate_rental_return: ${error?.message ?? "unknown"}`,
        retryable: true,
      };
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
  iron_schedule_follow_up,
  iron_initiate_rental_return,
};
