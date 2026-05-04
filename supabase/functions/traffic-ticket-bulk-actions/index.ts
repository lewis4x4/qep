/**
 * Traffic Ticket Bulk Actions
 *
 * Supports the IntelliDealer-style Mass Change / Print workflow backend:
 * selected traffic tickets can be bulk-updated, marked printed, or both.
 * The response returns receipt fields for browser/native print rendering;
 * it does not generate a provider-specific printer job or PDF.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const MAX_TICKETS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(["bulk_update", "print_receipts", "mass_change_print"]);
const ALLOWED_STATUSES = new Set(["haul_pending", "scheduled", "being_shipped", "completed"]);
const ALLOWED_MOVE_MODES = new Set(["pickup", "delivery"]);

type BulkAction = "bulk_update" | "print_receipts" | "mass_change_print";

interface BulkChanges {
  status?: unknown;
  driver_id?: unknown;
  coordinator_id?: unknown;
  shipping_date?: unknown;
  priority_code?: unknown;
  urgency?: unknown;
  move_mode?: unknown;
  trucker_code?: unknown;
  trucker_vendor_id?: unknown;
  ship_instructions?: unknown;
  billing_comments?: unknown;
}

interface BulkRequest {
  action?: unknown;
  ticket_ids?: unknown;
  changes?: BulkChanges;
}

interface ReceiptRow {
  id: string;
  workspace_id: string;
  receipt_number: string | null;
  status: string;
  printed_count: number;
  last_printed_at: string | null;
  stock_number: string;
  ticket_type: string;
  receipt_type: string | null;
  direction: string | null;
  shipping_date: string;
  from_location: string;
  to_location: string;
  to_contact_name: string;
  to_contact_phone: string;
  unit_description_snapshot: string | null;
  make_snapshot: string | null;
  model_snapshot: string | null;
  serial_number_snapshot: string | null;
  ship_instructions: string | null;
  billing_comments: string | null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const body = await req.json() as BulkRequest;
    const action = normalizeAction(body.action);
    if (!action) return safeJsonError("Invalid action", 400, origin);

    const ticketIds = normalizeTicketIds(body.ticket_ids);
    if (!ticketIds.ok) return safeJsonError(ticketIds.error, 400, origin);

    const shouldUpdate = action === "bulk_update" || action === "mass_change_print";
    const shouldPrint = action === "print_receipts" || action === "mass_change_print";

    let updatedRows: unknown[] = [];
    if (shouldUpdate) {
      const changes = normalizeChanges(body.changes);
      if (!changes.ok) return safeJsonError(changes.error, 400, origin);
      if (Object.keys(changes.value).length === 0) {
        return safeJsonError("No supported changes provided", 400, origin);
      }
      updatedRows = await bulkUpdateTickets(auth.supabase, ticketIds.value, changes.value);
    }

    const receiptRows = shouldPrint
      ? await markPrinted(auth.supabase, ticketIds.value)
      : [];

    return safeJsonOk({
      action,
      requested_count: ticketIds.value.length,
      updated_count: updatedRows.length,
      printed_count: receiptRows.length,
      updated_tickets: updatedRows,
      printable_receipts: receiptRows.map(toPrintableReceipt),
      external_print_job: null,
      external_print_job_note:
        "No external printer/PDF provider is configured; receipts are returned for the caller to render and print.",
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "traffic-ticket-bulk-actions", req });
    console.error("traffic-ticket-bulk-actions error:", err);
    if (err instanceof SyntaxError) return safeJsonError("Invalid JSON body", 400, origin);
    return safeJsonError(err instanceof Error ? err.message : "Internal server error", 500, origin);
  }
});

function normalizeAction(value: unknown): BulkAction | null {
  return typeof value === "string" && ALLOWED_ACTIONS.has(value) ? value as BulkAction : null;
}

function normalizeTicketIds(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "ticket_ids must be an array" };
  const ids = Array.from(new Set(value));
  if (ids.length === 0) return { ok: false, error: "At least one ticket_id is required" };
  if (ids.length > MAX_TICKETS) return { ok: false, error: `At most ${MAX_TICKETS} tickets can be processed at once` };
  if (!ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return { ok: false, error: "ticket_ids must be UUID strings" };
  }
  return { ok: true, value: ids as string[] };
}

function normalizeChanges(
  value: BulkChanges | undefined,
): { ok: true; value: Record<string, string | null> } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: true, value: {} };
  }

  const changes: Record<string, string | null> = {};
  const nullableUuidFields = ["driver_id", "coordinator_id", "trucker_vendor_id"] as const;
  const nullableTextFields = ["priority_code", "urgency", "trucker_code", "ship_instructions", "billing_comments"] as const;

  if (value.status !== undefined) {
    if (typeof value.status !== "string" || !ALLOWED_STATUSES.has(value.status)) {
      return { ok: false, error: "status must be haul_pending, scheduled, being_shipped, or completed" };
    }
    changes.status = value.status;
  }

  if (value.shipping_date !== undefined) {
    if (!isIsoDate(value.shipping_date)) return { ok: false, error: "shipping_date must be YYYY-MM-DD" };
    changes.shipping_date = value.shipping_date;
  }

  if (value.move_mode !== undefined) {
    if (value.move_mode !== null && (typeof value.move_mode !== "string" || !ALLOWED_MOVE_MODES.has(value.move_mode))) {
      return { ok: false, error: "move_mode must be pickup, delivery, or null" };
    }
    changes.move_mode = value.move_mode as string | null;
  }

  for (const field of nullableUuidFields) {
    const fieldValue = value[field];
    if (fieldValue === undefined) continue;
    if (fieldValue !== null && (typeof fieldValue !== "string" || !UUID_RE.test(fieldValue))) {
      return { ok: false, error: `${field} must be a UUID string or null` };
    }
    changes[field] = fieldValue as string | null;
  }

  for (const field of nullableTextFields) {
    const fieldValue = value[field];
    if (fieldValue === undefined) continue;
    if (fieldValue !== null && typeof fieldValue !== "string") {
      return { ok: false, error: `${field} must be a string or null` };
    }
    changes[field] = fieldValue === null ? null : fieldValue.trim();
  }

  return { ok: true, value: changes };
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

async function bulkUpdateTickets(
  supabase: SupabaseClient,
  ticketIds: string[],
  changes: Record<string, string | null>,
): Promise<unknown[]> {
  const { data, error } = await supabase
    .from("traffic_tickets")
    .update(changes)
    .in("id", ticketIds)
    .select("id, workspace_id, receipt_number, status, shipping_date, driver_id, coordinator_id, priority_code, urgency, move_mode, trucker_code, trucker_vendor_id, updated_at");

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function markPrinted(
  supabase: SupabaseClient,
  ticketIds: string[],
): Promise<ReceiptRow[]> {
  const { data, error } = await supabase.rpc("traffic_ticket_mark_printed", {
    p_ticket_ids: ticketIds,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReceiptRow[];
}

function toPrintableReceipt(row: ReceiptRow): Record<string, unknown> {
  const unit = [row.unit_description_snapshot, row.make_snapshot, row.model_snapshot]
    .filter(Boolean)
    .join(" ");
  const title = `Traffic Receipt ${row.receipt_number ?? row.id}`;
  const markdown = [
    `# ${title}`,
    `Status: ${row.status}`,
    `Ship date: ${row.shipping_date}`,
    `From: ${row.from_location}`,
    `To: ${row.to_location}`,
    `Contact: ${row.to_contact_name} ${row.to_contact_phone}`,
    `Stock: ${row.stock_number}`,
    unit ? `Unit: ${unit}` : null,
    row.serial_number_snapshot ? `Serial: ${row.serial_number_snapshot}` : null,
    row.ship_instructions ? `Instructions: ${row.ship_instructions}` : null,
    row.billing_comments ? `Billing/comments: ${row.billing_comments}` : null,
  ].filter(Boolean).join("\n");

  return {
    ...row,
    title,
    unit_description: unit || null,
    delivery_receipt_markdown: markdown,
  };
}
