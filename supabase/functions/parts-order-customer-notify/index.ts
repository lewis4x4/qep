/**
 * Staff-triggered email to portal customer when a parts order ships.
 * Auth: internal service user JWT (requireServiceUser).
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import { parseJsonBody } from "../_shared/parse-json-body.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const parsed = await parseJsonBody(req, origin);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as Record<string, unknown>;
  const orderId = typeof body.parts_order_id === "string" ? body.parts_order_id.trim() : "";
  const event = typeof body.event === "string" ? body.event.trim() : "";

  if (!orderId || event !== "parts_shipped") {
    return safeJsonError("parts_order_id and event=parts_shipped required", 400, origin);
  }

  const { supabase } = auth;

  const { data: row, error } = await supabase
    .from("parts_orders")
    .select(`
      id,
      workspace_id,
      status,
      fulfillment_run_id,
      tracking_number,
      estimated_delivery,
      portal_customers ( email, notification_preferences )
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !row) {
    return safeJsonError("Order not found", 404, origin);
  }

  if (row.status !== "shipped") {
    return safeJsonError("Order must be in shipped status to send shipment email", 400, origin);
  }

  const tr = row.tracking_number ? String(row.tracking_number).trim() : "";
  const eta = row.estimated_delivery ? String(row.estimated_delivery).trim() : "";
  const shortId = orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const ws = typeof row.workspace_id === "string" ? row.workspace_id : "default";
  const runId = row.fulfillment_run_id as string | null | undefined;

  if (runId) {
    const ev = await supabase.from("parts_fulfillment_events").insert({
      workspace_id: ws,
      fulfillment_run_id: runId,
      event_type: "portal_shipped",
      payload: {
        parts_order_id: orderId,
        tracking_number: tr || null,
        estimated_delivery: eta || null,
      },
    });
    if (ev.error) {
      console.warn("parts-order-customer-notify fulfillment event:", ev.error);
    }
    const up = await supabase
      .from("parts_fulfillment_runs")
      .update({ status: "shipped" })
      .eq("id", runId)
      .eq("workspace_id", ws);
    if (up.error) {
      console.warn("parts-order-customer-notify fulfillment run status:", up.error);
    }
  }

  type PortalCustRow = { email?: string; notification_preferences?: unknown };
  const cust = one(row.portal_customers as PortalCustRow | PortalCustRow[] | null) as PortalCustRow | null;
  const email = typeof cust?.email === "string" ? cust.email.trim() : "";
  const prefs = cust?.notification_preferences as { email?: boolean } | undefined;
  if (prefs?.email === false) {
    return safeJsonOk({ ok: true, email: "skipped_preferences" }, origin);
  }
  if (!email.includes("@")) {
    return safeJsonOk({ ok: true, email: "skipped_no_address" }, origin);
  }

  const text =
    `Your parts order (${shortId}) has shipped.\n\n` +
    (tr ? `Tracking number: ${tr}\n` : "") +
    (eta ? `Estimated delivery: ${eta}\n` : "") +
    `\nThank you for choosing Quality Equipment & Parts.`;

  const result = await sendResendEmail({
    to: email,
    subject: `QEP — Parts order shipped (${shortId})`,
    text,
  });

  if (result.skipped) {
    return safeJsonOk({ ok: true, email: "skipped_resend_unconfigured" }, origin);
  }
  return safeJsonOk(
    { ok: true, email: result.ok ? "sent" : "failed" },
    origin,
  );
});
