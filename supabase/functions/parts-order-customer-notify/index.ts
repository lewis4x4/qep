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
      tracking_number,
      estimated_delivery,
      crm_company_id,
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

  type PortalCustRow = { email?: string; notification_preferences?: unknown };
  const cust = one(row.portal_customers as PortalCustRow | PortalCustRow[] | null) as PortalCustRow | null;
  let email = typeof cust?.email === "string" ? cust.email.trim() : "";
  const prefs = cust?.notification_preferences as { email?: boolean } | undefined;
  if (cust && prefs?.email === false) {
    return safeJsonOk({ ok: true, email: "skipped_preferences" }, origin);
  }

  const crmCompanyId =
    typeof row.crm_company_id === "string" ? row.crm_company_id.trim() : "";
  if (!email.includes("@") && crmCompanyId) {
    const { data: contacts } = await supabase
      .from("crm_contacts")
      .select("email, updated_at")
      .eq("primary_company_id", crmCompanyId)
      .not("email", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1);
    const c = one(contacts);
    if (c && typeof (c as { email?: string }).email === "string") {
      email = String((c as { email: string }).email).trim();
    }
  }

  if (!email.includes("@")) {
    return safeJsonOk({ ok: true, email: "skipped_no_address" }, origin);
  }

  const workspaceId = typeof row.workspace_id === "string" ? row.workspace_id : "default";
  const { error: dedupeErr } = await supabase.from("parts_order_notification_sends").insert({
    workspace_id: workspaceId,
    parts_order_id: orderId,
    event_type: event,
  });
  if (dedupeErr?.code === "23505") {
    return safeJsonOk({ ok: true, email: "deduped_already_sent" }, origin);
  }
  if (dedupeErr) {
    console.error("parts-order-customer-notify dedupe:", dedupeErr);
    return safeJsonError("Could not record shipment notification", 400, origin);
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
    await supabase
      .from("parts_order_notification_sends")
      .delete()
      .eq("parts_order_id", orderId)
      .eq("event_type", event);
    return safeJsonOk({ ok: true, email: "skipped_resend_unconfigured" }, origin);
  }
  if (!result.ok) {
    await supabase
      .from("parts_order_notification_sends")
      .delete()
      .eq("parts_order_id", orderId)
      .eq("event_type", event);
  }
  return safeJsonOk(
    { ok: true, email: result.ok ? "sent" : "failed" },
    origin,
  );
});
