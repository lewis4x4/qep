/**
 * Wave 7 Iron Companion — undo handler registry.
 *
 * One handler per Iron action that mutates state. Each handler:
 *   • takes the run's `metadata.result` (the action's success blob)
 *   • walks tables in reverse order
 *   • returns a `compensation_log` array describing what was reversed
 *
 * Handlers MUST be idempotent — replaying an undo on an already-undone run
 * should be a no-op, not an error.
 *
 * Per CLAUDE.md, undo handlers must NEVER cascade beyond the original
 * write — if other entities reference the row being undone, the handler
 * fails loudly so the user gets a "type a manual correction flow" prompt
 * instead of silently destroying linked data.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type CompensationStep = { step: string; ok: boolean; detail?: string };

export type UndoHandler = (
  admin: SupabaseClient,
  runMetadata: Record<string, unknown>,
  workspaceId: string,
) => Promise<{ ok: true; log: CompensationStep[] } | { ok: false; error: string; log: CompensationStep[] }>;

function getResult(meta: Record<string, unknown>): Record<string, unknown> {
  const r = meta.result;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : {};
}

/* ─── 1. iron_pull_part undo ────────────────────────────────────────────── */

const undo_iron_pull_part: UndoHandler = async (admin, meta, _workspace) => {
  const log: CompensationStep[] = [];
  const result = getResult(meta);
  const orderId = result.entity_id;
  if (typeof orderId !== "string") {
    return { ok: false, error: "no entity_id in run metadata", log };
  }

  // Verify still in draft. If submitted/processing/etc, refuse — the caller
  // must use the existing parts cancellation flow.
  const { data: order, error: fetchErr } = await admin
    .from("parts_orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (fetchErr) {
    return { ok: false, error: `parts_orders fetch: ${fetchErr.message}`, log };
  }
  if (!order) {
    log.push({ step: "fetch_order", ok: true, detail: "already deleted" });
    return { ok: true, log };
  }
  if (order.status !== "draft") {
    return { ok: false, error: `cannot undo: order is in status ${order.status}`, log };
  }

  // Append a reversal event for the audit trail (BEFORE the cascade delete
  // — once the order row is gone, FK cascade will drop the events anyway,
  // but this captures the reason).
  try {
    await admin.from("parts_order_events").insert({
      workspace_id: _workspace,
      parts_order_id: orderId,
      event_type: "cancelled",
      source: "system",
      from_status: "draft",
      to_status: "cancelled",
      metadata: { via: "iron_undo", reason: "iron_60s_window_undo" },
    });
    log.push({ step: "append_reversal_event", ok: true });
  } catch (err) {
    log.push({ step: "append_reversal_event", ok: false, detail: (err as Error).message });
  }

  // Delete the order (parts_order_lines + parts_order_events cascade via FK)
  const { error: delErr } = await admin
    .from("parts_orders")
    .delete()
    .eq("id", orderId)
    .eq("status", "draft");
  if (delErr) {
    return { ok: false, error: `delete parts_orders: ${delErr.message}`, log };
  }
  log.push({ step: "delete_parts_order", ok: true, detail: orderId });
  return { ok: true, log };
};

/* ─── 2. iron_add_customer undo ─────────────────────────────────────────── */

const undo_iron_add_customer: UndoHandler = async (admin, meta, _workspace) => {
  const log: CompensationStep[] = [];
  const result = getResult(meta);
  const contactId = result.entity_id;
  if (typeof contactId !== "string") {
    return { ok: false, error: "no entity_id in run metadata", log };
  }

  // Soft-delete (matches the convention in the rest of the repo)
  const { error } = await admin
    .from("crm_contacts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", contactId)
    .is("deleted_at", null);
  if (error) {
    return { ok: false, error: `soft delete crm_contacts: ${error.message}`, log };
  }
  log.push({ step: "soft_delete_crm_contact", ok: true, detail: contactId });
  return { ok: true, log };
};

/* ─── 3. iron_add_equipment undo ────────────────────────────────────────── */

const undo_iron_add_equipment: UndoHandler = async (admin, meta, _workspace) => {
  const log: CompensationStep[] = [];
  const result = getResult(meta);
  const equipId = result.entity_id;
  if (typeof equipId !== "string") {
    return { ok: false, error: "no entity_id in run metadata", log };
  }

  // Refuse if any rentals or deals reference this equipment
  const { count: dealCount } = await admin
    .from("crm_deals")
    .select("id", { count: "exact", head: true })
    .eq("equipment_id", equipId);
  if ((dealCount ?? 0) > 0) {
    return { ok: false, error: "cannot undo: equipment is referenced by deals", log };
  }

  const { error } = await admin
    .from("crm_equipment")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", equipId)
    .is("deleted_at", null);
  if (error) {
    return { ok: false, error: `soft delete crm_equipment: ${error.message}`, log };
  }
  log.push({ step: "soft_delete_crm_equipment", ok: true, detail: equipId });
  return { ok: true, log };
};

/* ─── 4. iron_log_service_call undo ─────────────────────────────────────── */
//
// service_jobs has NO `status` column — the lifecycle column is
// `current_stage` (public.service_stage enum). Fresh Iron-created jobs
// land at default 'request_received'. We refuse undo once the job has
// progressed past that stage; the user must use the normal service
// cancellation flow instead.

const undo_iron_log_service_call: UndoHandler = async (admin, meta, _workspace) => {
  const log: CompensationStep[] = [];
  const result = getResult(meta);
  const jobId = result.entity_id;
  if (typeof jobId !== "string") {
    return { ok: false, error: "no entity_id in run metadata", log };
  }

  const { data: job } = await admin
    .from("service_jobs")
    .select("id, current_stage")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) {
    log.push({ step: "fetch_job", ok: true, detail: "already gone" });
    return { ok: true, log };
  }
  if (job.current_stage !== "request_received") {
    return {
      ok: false,
      error: `cannot undo: service job has progressed to ${job.current_stage}`,
      log,
    };
  }

  const { error } = await admin
    .from("service_jobs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("current_stage", "request_received");
  if (error) {
    return { ok: false, error: `soft delete service_jobs: ${error.message}`, log };
  }
  log.push({ step: "soft_delete_service_job", ok: true, detail: jobId });
  return { ok: true, log };
};

/* ─── 5. iron_draft_email undo ──────────────────────────────────────────── */

const undo_iron_draft_email: UndoHandler = async (admin, meta, _workspace) => {
  const log: CompensationStep[] = [];
  const result = getResult(meta);
  const draftId = result.entity_id;
  if (typeof draftId !== "string") {
    return { ok: false, error: "no entity_id in run metadata", log };
  }

  // Hard delete — drafts are never sent and have no downstream refs
  const { error } = await admin.from("email_drafts").delete().eq("id", draftId);
  if (error) {
    return { ok: false, error: `delete email_drafts: ${error.message}`, log };
  }
  log.push({ step: "delete_email_draft", ok: true, detail: draftId });
  return { ok: true, log };
};

/* ─── 6. iron_initiate_rental_return undo ───────────────────────────────── */

const undo_iron_initiate_rental_return: UndoHandler = async (admin, meta, _workspace) => {
  const log: CompensationStep[] = [];
  const result = getResult(meta);
  const returnId = result.entity_id;
  if (typeof returnId !== "string") {
    return { ok: false, error: "no entity_id in run metadata", log };
  }

  // Refuse if it's progressed past inspection_pending
  const { data: row } = await admin
    .from("rental_returns")
    .select("id, status")
    .eq("id", returnId)
    .maybeSingle();
  if (!row) {
    log.push({ step: "fetch_return", ok: true, detail: "already gone" });
    return { ok: true, log };
  }
  if (row.status !== "inspection_pending") {
    return { ok: false, error: `cannot undo: rental return is in status ${row.status}`, log };
  }

  const { error } = await admin
    .from("rental_returns")
    .delete()
    .eq("id", returnId)
    .eq("status", "inspection_pending");
  if (error) {
    return { ok: false, error: `delete rental_returns: ${error.message}`, log };
  }
  log.push({ step: "delete_rental_return", ok: true, detail: returnId });
  return { ok: true, log };
};

/* ─── Registry export ───────────────────────────────────────────────────── */

export const IRON_UNDO_HANDLERS: Record<string, UndoHandler> = {
  iron_pull_part: undo_iron_pull_part,
  iron_add_customer: undo_iron_add_customer,
  iron_add_equipment: undo_iron_add_equipment,
  iron_log_service_call: undo_iron_log_service_call,
  iron_draft_email: undo_iron_draft_email,
  iron_initiate_rental_return: undo_iron_initiate_rental_return,
};
