/**
 * QEP Flow Engine — action registry (Slice 2).
 *
 * 12 reusable side-effect actions. Each action:
 *   • declares an idempotency_key_template so replays are safe
 *   • respects dry_run by short-circuiting before any write
 *   • returns a typed FlowActionResult so the runner can log uniformly
 *
 * Actions wrap existing repo primitives (crm_activities, crm_notes,
 * crm_in_app_notifications, exception_queue) — no parallel side-effect code.
 */
import type { FlowAction, FlowActionDeps, FlowActionResult, FlowContext } from "./types.ts";

/* ─── Helper: param resolution against context ─────────────────────────── */

/** Walks `${event.payload.deal_id}` style placeholders against the context. */
function resolveValue(value: unknown, ctx: FlowContext): unknown {
  if (typeof value !== "string") return value;
  if (!value.includes("${")) return value;
  return value.replace(/\$\{([^}]+)\}/g, (_, path: string) => {
    const parts = path.trim().split(".");
    let cur: unknown = { event: ctx.event, context: ctx, payload: ctx.event.properties };
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur == null ? "" : String(cur);
  });
}

function resolveParams(params: Record<string, unknown>, ctx: FlowContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = resolveValue(v, ctx);
  }
  return out;
}

function dryRunSkip(deps: FlowActionDeps, key: string): FlowActionResult {
  return { status: "skipped", reason: `dry_run for ${key}` };
}

/* ─── 1. create_task ────────────────────────────────────────────────────── */

const create_task: FlowAction = {
  key: "create_task",
  description: "Create a CRM activity / task on a deal, contact, or company",
  affects_modules: ["qrm"],
  idempotency_key_template: "task:${event.entity_type}:${event.entity_id}:${event.flow_event_type}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "create_task");
    const p = resolveParams(params, ctx);
    const { data, error } = await deps.admin.from("crm_activities").insert({
      workspace_id: deps.workspace_id,
      activity_type: p.activity_type ?? "task",
      subject: p.subject ?? "Flow-generated task",
      body: p.body ?? null,
      due_at: p.due_at ?? null,
      deal_id: p.deal_id ?? null,
      contact_id: p.contact_id ?? null,
      company_id: p.company_id ?? null,
      assigned_to: p.assigned_to ?? null,
    }).select("id").maybeSingle();
    if (error) return { status: "failed", error: error.message, retryable: true };
    return { status: "succeeded", result: { activity_id: data?.id } };
  },
};

/* ─── 2. create_note ────────────────────────────────────────────────────── */

const create_note: FlowAction = {
  key: "create_note",
  description: "Append a note to an entity timeline",
  affects_modules: ["qrm"],
  idempotency_key_template: "note:${event.entity_type}:${event.entity_id}:${event.flow_event_type}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "create_note");
    const p = resolveParams(params, ctx);
    const { data, error } = await deps.admin.from("crm_activities").insert({
      workspace_id: deps.workspace_id,
      activity_type: "note",
      subject: p.subject ?? "Flow note",
      body: p.body ?? "",
      deal_id: p.deal_id ?? null,
      contact_id: p.contact_id ?? null,
      company_id: p.company_id ?? null,
    }).select("id").maybeSingle();
    if (error) return { status: "failed", error: error.message, retryable: true };
    return { status: "succeeded", result: { note_id: data?.id } };
  },
};

/* ─── 3. send_email_draft ───────────────────────────────────────────────── */

const send_email_draft: FlowAction = {
  key: "send_email_draft",
  description: "Create an email draft awaiting operator review",
  affects_modules: ["qrm", "communications"],
  idempotency_key_template: "email_draft:${event.entity_type}:${event.entity_id}:${event.flow_event_type}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "send_email_draft");
    const p = resolveParams(params, ctx);
    const { data, error } = await deps.admin.from("email_drafts").insert({
      workspace_id: deps.workspace_id,
      to_email: p.to_email,
      subject: p.subject,
      body: p.body,
      related_entity_type: ctx.event.entity_type,
      related_entity_id: ctx.event.entity_id,
      created_by_workflow: deps.run_id,
    }).select("id").maybeSingle();
    // email_drafts may not exist on every deployment — fail soft
    if (error) {
      if (error.message?.includes("does not exist")) {
        return { status: "skipped", reason: "email_drafts table not provisioned" };
      }
      return { status: "failed", error: error.message, retryable: true };
    }
    return { status: "succeeded", result: { draft_id: data?.id } };
  },
};

/* ─── 4. send_in_app_notification ───────────────────────────────────────── */

const send_in_app_notification: FlowAction = {
  key: "send_in_app_notification",
  description: "Push an in-app notification to a user",
  affects_modules: ["qrm"],
  idempotency_key_template: "notif:${params.user_id}:${event.flow_event_type}:${event.entity_id}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "send_in_app_notification");
    const p = resolveParams(params, ctx);
    const { data, error } = await deps.admin.from("crm_in_app_notifications").insert({
      workspace_id: deps.workspace_id,
      user_id: p.user_id,
      kind: p.kind ?? "flow",
      title: p.title,
      body: p.body ?? null,
      link: p.link ?? null,
      severity: p.severity ?? "info",
    }).select("id").maybeSingle();
    if (error) {
      if (error.message?.includes("does not exist")) {
        return { status: "skipped", reason: "crm_in_app_notifications table not provisioned" };
      }
      return { status: "failed", error: error.message, retryable: true };
    }
    return { status: "succeeded", result: { notification_id: data?.id } };
  },
};

/* ─── 5. update_deal_stage ──────────────────────────────────────────────── */

const update_deal_stage: FlowAction = {
  key: "update_deal_stage",
  description: "Move a deal to a new stage",
  affects_modules: ["qrm"],
  idempotency_key_template: "deal_stage:${params.deal_id}:${params.stage_id}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "update_deal_stage");
    const p = resolveParams(params, ctx);
    const { error } = await deps.admin.from("crm_deals").update({
      stage_id: p.stage_id,
      updated_at: new Date().toISOString(),
    }).eq("id", p.deal_id);
    if (error) return { status: "failed", error: error.message, retryable: true };
    return { status: "succeeded", result: { deal_id: p.deal_id, new_stage_id: p.stage_id } };
  },
};

/* ─── 6. tag_account ────────────────────────────────────────────────────── */

const tag_account: FlowAction = {
  key: "tag_account",
  description: "Append a tag to a company's tags array",
  affects_modules: ["qrm"],
  idempotency_key_template: "tag:${params.company_id}:${params.tag}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "tag_account");
    const p = resolveParams(params, ctx);
    const { data: existing, error: readErr } = await deps.admin
      .from("crm_companies")
      .select("tags")
      .eq("id", p.company_id)
      .maybeSingle();
    if (readErr) return { status: "failed", error: readErr.message, retryable: true };
    const tags = Array.isArray(existing?.tags) ? existing.tags : [];
    if (tags.includes(p.tag)) {
      return { status: "skipped", reason: "tag already present" };
    }
    const { error } = await deps.admin.from("crm_companies").update({
      tags: [...tags, p.tag],
    }).eq("id", p.company_id);
    if (error) return { status: "failed", error: error.message, retryable: true };
    return { status: "succeeded", result: { company_id: p.company_id, tag: p.tag } };
  },
};

/* ─── 7. create_exception ───────────────────────────────────────────────── */

const create_exception: FlowAction = {
  key: "create_exception",
  description: "Push a row into the human work queue (exception_queue)",
  affects_modules: ["ops"],
  idempotency_key_template: "exception:${params.source}:${event.entity_type}:${event.entity_id}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "create_exception");
    const p = resolveParams(params, ctx);
    const { data, error } = await deps.admin.rpc("enqueue_exception", {
      p_source: p.source ?? "data_quality",
      p_title: p.title,
      p_severity: p.severity ?? "warn",
      p_detail: p.detail ?? null,
      p_payload: { ...((p.payload as Record<string, unknown>) ?? {}), flow_run_id: deps.run_id },
      p_entity_table: ctx.event.entity_type,
      p_entity_id: ctx.event.entity_id,
    });
    if (error) return { status: "failed", error: error.message, retryable: true };
    return { status: "succeeded", result: { exception_id: data } };
  },
};

/* ─── 8. recompute_health_score ────────────────────────────────────────── */

const recompute_health_score: FlowAction = {
  key: "recompute_health_score",
  description: "Trigger health score recompute for a customer profile",
  affects_modules: ["qrm"],
  idempotency_key_template: "health:${params.customer_profile_id}:${event.event_id}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "recompute_health_score");
    const p = resolveParams(params, ctx);
    const { error } = await deps.admin.rpc("compute_health_score_rpc", {
      p_customer_profile_id: p.customer_profile_id,
    });
    if (error) {
      // RPC may not exist on all deployments
      if (error.message?.includes("does not exist")) {
        return { status: "skipped", reason: "compute_health_score_rpc not provisioned" };
      }
      return { status: "failed", error: error.message, retryable: true };
    }
    return { status: "succeeded", result: { customer_profile_id: p.customer_profile_id } };
  },
};

/* ─── 9. notify_service_recipient ───────────────────────────────────────── */

const notify_service_recipient: FlowAction = {
  key: "notify_service_recipient",
  description: "Notify the service writer / customer for a service job event",
  affects_modules: ["service"],
  idempotency_key_template: "service_notify:${params.service_job_id}:${event.flow_event_type}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "notify_service_recipient");
    const p = resolveParams(params, ctx);
    // Wraps the existing service-lifecycle-notify pattern by inserting into
    // crm_in_app_notifications scoped to the service writer.
    const { data: job, error: jobErr } = await deps.admin
      .from("service_jobs")
      .select("service_writer_id, customer_id")
      .eq("id", p.service_job_id)
      .maybeSingle();
    if (jobErr) return { status: "failed", error: jobErr.message, retryable: true };
    if (!job?.service_writer_id) {
      return { status: "skipped", reason: "no service writer assigned" };
    }
    const { error } = await deps.admin.from("crm_in_app_notifications").insert({
      workspace_id: deps.workspace_id,
      user_id: job.service_writer_id,
      kind: "service_update",
      title: p.title,
      body: p.body ?? null,
      link: `/service/jobs/${p.service_job_id}`,
      severity: p.severity ?? "info",
    });
    if (error && !error.message?.includes("does not exist")) {
      return { status: "failed", error: error.message, retryable: true };
    }
    return { status: "succeeded", result: { service_job_id: p.service_job_id } };
  },
};

/* ─── 10. escalate_parts_vendor ─────────────────────────────────────────── */

const escalate_parts_vendor: FlowAction = {
  key: "escalate_parts_vendor",
  description: "Mark a parts order for vendor escalation",
  affects_modules: ["parts"],
  idempotency_key_template: "parts_escalate:${params.parts_order_id}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "escalate_parts_vendor");
    const p = resolveParams(params, ctx);
    const { error } = await deps.admin.from("parts_orders").update({
      escalation_status: "vendor_escalated",
      escalation_reason: p.reason ?? "flow_engine",
      escalated_at: new Date().toISOString(),
    }).eq("id", p.parts_order_id);
    if (error) {
      if (error.message?.includes("does not exist") || error.message?.includes("column")) {
        return { status: "skipped", reason: "parts_orders escalation columns not provisioned" };
      }
      return { status: "failed", error: error.message, retryable: true };
    }
    return { status: "succeeded", result: { parts_order_id: p.parts_order_id } };
  },
};

/* ─── 11. create_audit_event ────────────────────────────────────────────── */

const create_audit_event: FlowAction = {
  key: "create_audit_event",
  description: "Append an audit row to analytics_action_log",
  affects_modules: ["audit"],
  idempotency_key_template: "audit:${event.flow_event_type}:${event.entity_id}:${params.tag}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "create_audit_event");
    const p = resolveParams(params, ctx);
    const { error } = await deps.admin.from("analytics_action_log").insert({
      workspace_id: deps.workspace_id,
      action_type: "action_launch",
      source_widget: "flow_engine",
      metadata: { tag: p.tag, run_id: deps.run_id, event_id: ctx.event.event_id, ...((p.metadata as Record<string, unknown>) ?? {}) },
    });
    if (error) return { status: "failed", error: error.message, retryable: true };
    return { status: "succeeded", result: { logged: true } };
  },
};

/* ─── 12. request_approval (stub — Slice 3 fills in flow_approvals) ─────── */

const request_approval: FlowAction = {
  key: "request_approval",
  description: "Pause workflow pending human approval",
  affects_modules: ["governance"],
  idempotency_key_template: "approval:${event.entity_type}:${event.entity_id}:${params.subject}",
  async execute(params, ctx, deps) {
    if (deps.dry_run) return dryRunSkip(deps, "request_approval");
    const p = resolveParams(params, ctx);
    // Slice 3 inserts into flow_approvals + suspends run. Slice 2 stub:
    // create an exception row tagged 'approval_request' so it surfaces in
    // the inbox until the dedicated table ships.
    const { data, error } = await deps.admin.rpc("enqueue_exception", {
      p_source: "data_quality",
      p_title: `Approval needed: ${p.subject}`,
      p_severity: "warn",
      p_detail: (p.detail as string) ?? null,
      p_payload: {
        flow_run_id: deps.run_id,
        approval_assigned_role: p.assigned_role,
        original_event_id: ctx.event.event_id,
        approval_subject: p.subject,
      },
      p_entity_table: ctx.event.entity_type,
      p_entity_id: ctx.event.entity_id,
    });
    if (error) return { status: "failed", error: error.message, retryable: true };
    return { status: "succeeded", result: { approval_request_id: data, slice: "stub_until_3" } };
  },
};

/* ─── Registry export ───────────────────────────────────────────────────── */

export const ACTION_REGISTRY: Record<string, FlowAction> = {
  create_task,
  create_note,
  send_email_draft,
  send_in_app_notification,
  update_deal_stage,
  tag_account,
  create_exception,
  recompute_health_score,
  notify_service_recipient,
  escalate_parts_vendor,
  create_audit_event,
  request_approval,
};

export function getAction(key: string): FlowAction {
  const action = ACTION_REGISTRY[key];
  if (!action) {
    throw new Error(`flow_engine: action '${key}' not found in registry`);
  }
  return action;
}
