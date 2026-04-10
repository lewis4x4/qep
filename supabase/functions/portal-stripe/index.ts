/**
 * Portal Stripe Edge Function (Wave 5D / Phase 2D)
 *
 * Two routes:
 *   POST /create-checkout      → create a Stripe Checkout Session for an
 *                                AR invoice payment. Returns { url } on
 *                                success or { fallback: 'mailto:...' } if
 *                                STRIPE_SECRET_KEY is unset (zero-blocking
 *                                fallback per v2 §9.3).
 *   POST /webhook              → Stripe webhook receiver. MUST verify the
 *                                signature with STRIPE_WEBHOOK_SECRET before
 *                                touching any AR rows. On succeeded event:
 *                                marks portal_payment_intents.status =
 *                                'succeeded', stamps webhook_signature_
 *                                verified = true, and reconciles the linked
 *                                invoice row idempotently.
 *
 * Hard security gates (v2 §9.4):
 *   - Webhook signature verified
 *   - No plaintext PAN ever stored — Stripe Checkout handles card entry
 *   - workspace_id from caller profile, never trusted from request
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
import { resolveProfileActiveWorkspaceId } from "../_shared/workspace.ts";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const STRIPE_API_BASE = "https://api.stripe.com/v1";

interface PortalPaymentIntentRow {
  id: string;
  invoice_id: string | null;
  amount_cents: number;
  stripe_payment_intent_id: string;
  metadata: Record<string, unknown> | null;
}

interface PortalInvoiceRow {
  id: string;
  total: number;
  amount_paid: number | null;
  status: string;
  paid_at: string | null;
  payment_reference: string | null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const url = new URL(req.url);
  const action = url.pathname.split("/").pop() || "";

  try {
    // ── /webhook (no auth — uses Stripe signature) ─────────────────────
    if (action === "webhook" && req.method === "POST") {
      return await handleWebhook(req, origin);
    }

    // All other routes require auth
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

    const workspace = await resolveProfileActiveWorkspaceId(supabaseAdmin, user.id);

    // ── /create-checkout ──────────────────────────────────────────────
    if (action === "create-checkout" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const amountCents: number = Number(body.amount_cents);
      const invoiceId: string | undefined = body.invoice_id;
      const companyId: string | undefined = body.company_id;
      const customerEmail: string | undefined = body.customer_email;
      const description: string = body.description || "QEP invoice payment";
      const successUrl: string = body.success_url || `${origin}/portal/invoices?paid=1`;
      const cancelUrl: string = body.cancel_url || `${origin}/portal/invoices`;

      if (!amountCents || amountCents < 50) {
        return safeJsonError("amount_cents required (min 50)", 400, origin);
      }
      if (!companyId) return safeJsonError("company_id required", 400, origin);

      // Zero-blocking fallback: STRIPE_SECRET_KEY missing → mailto path
      if (!STRIPE_SECRET_KEY) {
        const mailto = buildMailtoFallback(invoiceId, amountCents, description);
        return safeJsonOk({
          fallback: mailto,
          stripe_configured: false,
          message: "Stripe is not configured on this workspace. Use the mailto fallback to coordinate payment.",
        }, origin);
      }

      // Create Stripe Checkout Session via REST (no SDK dependency)
      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("payment_method_types[]", "card");
      params.set("success_url", successUrl);
      params.set("cancel_url", cancelUrl);
      params.set("line_items[0][price_data][currency]", "usd");
      params.set("line_items[0][price_data][product_data][name]", description);
      params.set("line_items[0][price_data][unit_amount]", String(amountCents));
      params.set("line_items[0][quantity]", "1");
      if (customerEmail) params.set("customer_email", customerEmail);
      if (invoiceId) params.set("metadata[invoice_id]", invoiceId);
      if (invoiceId) params.set("payment_intent_data[metadata][invoice_id]", invoiceId);
      params.set("metadata[company_id]", companyId);
      params.set("payment_intent_data[metadata][company_id]", companyId);
      params.set("metadata[workspace_id]", workspace);
      params.set("payment_intent_data[metadata][workspace_id]", workspace);

      const stripeRes = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!stripeRes.ok) {
        const err = await stripeRes.text();
        console.error("Stripe checkout create failed:", err);
        // Fall back to mailto on Stripe outage
        const mailto = buildMailtoFallback(invoiceId, amountCents, description);
        return safeJsonOk({
          fallback: mailto,
          stripe_configured: true,
          stripe_error: true,
          message: "Stripe request failed. Mailto fallback provided.",
        }, origin);
      }

      const session = await stripeRes.json();

      // Persist intent record
      await supabaseAdmin.from("portal_payment_intents").insert({
        workspace_id: workspace,
        company_id: companyId,
        invoice_id: invoiceId ?? null,
        stripe_payment_intent_id: session.payment_intent || session.id,
        amount_cents: amountCents,
        currency: "usd",
        status: "requires_payment_method",
        customer_email: customerEmail ?? null,
        metadata: { checkout_session_id: session.id, invoice_id: invoiceId ?? null },
        created_by: user.id,
      });

      return safeJsonOk({
        url: session.url,
        session_id: session.id,
        stripe_configured: true,
      }, origin);
    }

    return safeJsonError("Not found", 404, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "portal-stripe", req });
    console.error("portal-stripe error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
});

/* ── Webhook handler (signature-verified) ────────────────────────── */

async function handleWebhook(req: Request, origin: string | null): Promise<Response> {
  if (!STRIPE_WEBHOOK_SECRET) {
    return safeJsonError("Webhook not configured", 503, origin);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return safeJsonError("Missing stripe-signature", 400, origin);

  const rawBody = await req.text();

  // Verify signature
  const verified = await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  if (!verified) return safeJsonError("Invalid signature", 401, origin);

  const event = JSON.parse(rawBody);

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Handle the events we care about
  if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
    const obj = event.data?.object ?? {};
    const intentId = obj.payment_intent || obj.id;
    const checkoutSessionId = typeof obj.id === "string" && event.type === "checkout.session.completed"
      ? obj.id
      : typeof obj.object === "string" && obj.object === "checkout.session"
        ? obj.id
        : null;
    if (intentId || checkoutSessionId) {
      await reconcileSucceededPayment({
        supabaseAdmin,
        eventId: typeof event.id === "string" ? event.id : null,
        stripePaymentIntentId: typeof intentId === "string" ? intentId : null,
        checkoutSessionId,
        fallbackAmountCents: Number(obj.amount_total ?? obj.amount_received ?? 0) || null,
      });
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const obj = event.data?.object ?? {};
    await supabaseAdmin
      .from("portal_payment_intents")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_reason: obj.last_payment_error?.message ?? "unknown",
        webhook_signature_verified: true,
      })
      .eq("stripe_payment_intent_id", obj.id);
  }

  return safeJsonOk({ received: true }, origin);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function findPortalPaymentIntent(
  supabaseAdmin: ReturnType<typeof createClient>,
  stripePaymentIntentId: string | null,
  checkoutSessionId: string | null,
): Promise<PortalPaymentIntentRow | null> {
  if (stripePaymentIntentId) {
    const { data } = await supabaseAdmin
      .from("portal_payment_intents")
      .select("id, invoice_id, amount_cents, stripe_payment_intent_id, metadata")
      .eq("stripe_payment_intent_id", stripePaymentIntentId)
      .maybeSingle();
    if (data) return data as PortalPaymentIntentRow;
  }

  if (checkoutSessionId) {
    const { data } = await supabaseAdmin
      .from("portal_payment_intents")
      .select("id, invoice_id, amount_cents, stripe_payment_intent_id, metadata")
      .contains("metadata", { checkout_session_id: checkoutSessionId })
      .maybeSingle();
    if (data) return data as PortalPaymentIntentRow;
  }

  return null;
}

async function reconcileSucceededPayment(input: {
  supabaseAdmin: ReturnType<typeof createClient>;
  eventId: string | null;
  stripePaymentIntentId: string | null;
  checkoutSessionId: string | null;
  fallbackAmountCents: number | null;
}): Promise<void> {
  const paymentIntent = await findPortalPaymentIntent(
    input.supabaseAdmin,
    input.stripePaymentIntentId,
    input.checkoutSessionId,
  );

  const now = new Date().toISOString();
  if (!paymentIntent) {
    if (input.stripePaymentIntentId) {
      await input.supabaseAdmin
        .from("portal_payment_intents")
        .update({
          status: "succeeded",
          succeeded_at: now,
          webhook_signature_verified: true,
        })
        .eq("stripe_payment_intent_id", input.stripePaymentIntentId);
    }
    return;
  }

  const metadata = asRecord(paymentIntent.metadata);
  const alreadyAppliedAt = typeof metadata.invoice_payment_applied_at === "string"
    ? metadata.invoice_payment_applied_at
    : null;
  const amountCents = paymentIntent.amount_cents > 0
    ? paymentIntent.amount_cents
    : Math.max(0, input.fallbackAmountCents ?? 0);
  const intentId = input.stripePaymentIntentId ?? paymentIntent.stripe_payment_intent_id;

  if (!alreadyAppliedAt && paymentIntent.invoice_id && amountCents > 0) {
    const { data: invoiceRow } = await input.supabaseAdmin
      .from("customer_invoices")
      .select("id, total, amount_paid, status, paid_at, payment_reference")
      .eq("id", paymentIntent.invoice_id)
      .maybeSingle();

    if (invoiceRow) {
      const invoice = invoiceRow as PortalInvoiceRow;
      const amount = amountCents / 100;
      const currentAmountPaid = Number(invoice.amount_paid ?? 0);
      const invoiceTotal = Number(invoice.total ?? 0);
      const balance = Math.max(invoiceTotal - currentAmountPaid, 0);
      if (balance > 0) {
        const appliedAmount = Math.min(balance, amount);
        const nextAmountPaid = currentAmountPaid + appliedAmount;
        await input.supabaseAdmin
          .from("customer_invoices")
          .update({
            amount_paid: nextAmountPaid,
            payment_method: "stripe",
            payment_reference: `stripe:${intentId}`,
            paid_at: nextAmountPaid >= invoiceTotal ? (invoice.paid_at ?? now) : invoice.paid_at,
            status: nextAmountPaid >= invoiceTotal
              ? "paid"
              : nextAmountPaid > 0
                ? "partial"
                : invoice.status,
            updated_at: now,
          })
          .eq("id", invoice.id);
      }
    }
  }

  await input.supabaseAdmin
    .from("portal_payment_intents")
    .update({
      stripe_payment_intent_id: intentId,
      status: "succeeded",
      succeeded_at: now,
      webhook_signature_verified: true,
      metadata: {
        ...metadata,
        stripe_event_id: input.eventId,
        invoice_payment_applied_at: alreadyAppliedAt ?? now,
      },
    })
    .eq("id", paymentIntent.id);
}

/* ── HMAC-SHA256 Stripe signature verification ───────────────────── */

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  // Stripe header format: "t=<timestamp>,v1=<signature>,v0=<legacy>"
  const parts = sigHeader.split(",").map((p) => p.trim().split("="));
  const timestamp = parts.find((p) => p[0] === "t")?.[1];
  const v1 = parts.find((p) => p[0] === "v1")?.[1];
  if (!timestamp || !v1) return false;

  // Tolerance window: 5 minutes
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const computed = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Constant-time compare
  if (computed.length !== v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return mismatch === 0;
}

/* ── Mailto fallback (zero-blocking) ─────────────────────────────── */

function buildMailtoFallback(invoiceId: string | undefined, amountCents: number, description: string): string {
  const dollars = (amountCents / 100).toFixed(2);
  const subject = encodeURIComponent(`Payment for invoice ${invoiceId ?? ""} — $${dollars}`);
  const body = encodeURIComponent(
    `Hi,\n\nI'd like to pay the following:\n\n` +
    `Invoice: ${invoiceId ?? "(unspecified)"}\n` +
    `Amount: $${dollars}\n` +
    `Description: ${description}\n\n` +
    `Please send a payment link or call me to take payment over the phone.\n`,
  );
  return `mailto:?subject=${subject}&body=${body}`;
}
