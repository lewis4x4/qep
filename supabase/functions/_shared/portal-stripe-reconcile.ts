import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface PortalPaymentIntentRow {
  id: string;
  invoice_id: string | null;
  amount_cents: number;
  stripe_payment_intent_id: string;
  metadata: Record<string, unknown> | null;
}

export interface PortalInvoiceRow {
  id: string;
  total: number;
  amount_paid: number | null;
  status: string;
  paid_at: string | null;
  payment_reference: string | null;
  crm_company_id?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function findPortalPaymentIntent(
  supabaseAdmin: SupabaseClient,
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

export async function recomputeHealthScoreForInvoice(input: {
  supabaseAdmin: SupabaseClient;
  invoice: PortalInvoiceRow;
  metadata: Record<string, unknown>;
  now: string;
}): Promise<Record<string, unknown>> {
  const crmCompanyId = typeof input.invoice.crm_company_id === "string"
    ? input.invoice.crm_company_id.trim()
    : "";
  if (!crmCompanyId) {
    return {
      ...input.metadata,
      health_score_recompute_error: "missing_crm_company_id",
    };
  }

  const { data: profileRow, error: profileErr } = await input.supabaseAdmin
    .from("customer_profiles_extended")
    .select("id")
    .eq("crm_company_id", crmCompanyId)
    .limit(1)
    .maybeSingle();

  if (profileErr || !profileRow?.id) {
    return {
      ...input.metadata,
      health_score_recompute_error: profileErr?.message ?? "customer_profile_not_found",
    };
  }

  const { error: recomputeErr } = await input.supabaseAdmin.rpc("compute_customer_health_score", {
    p_customer_profile_id: profileRow.id,
  });

  if (recomputeErr) {
    return {
      ...input.metadata,
      health_score_recompute_error: recomputeErr.message,
    };
  }

  const nextMetadata: Record<string, unknown> = {
    ...input.metadata,
    health_score_recompute_at: input.now,
  };
  delete nextMetadata.health_score_recompute_error;
  return nextMetadata;
}

export async function reconcileSucceededPayment(input: {
  supabaseAdmin: SupabaseClient;
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

  let nextMetadata: Record<string, unknown> = {
    ...metadata,
    stripe_event_id: input.eventId,
    invoice_payment_applied_at: alreadyAppliedAt ?? now,
  };

  if (!alreadyAppliedAt && paymentIntent.invoice_id && amountCents > 0) {
    const { data: invoiceRow } = await input.supabaseAdmin
      .from("customer_invoices")
      .select("id, total, amount_paid, status, paid_at, payment_reference, crm_company_id")
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

      nextMetadata = await recomputeHealthScoreForInvoice({
        supabaseAdmin: input.supabaseAdmin,
        invoice,
        metadata: nextMetadata,
        now,
      });
    } else {
      nextMetadata = {
        ...nextMetadata,
        health_score_recompute_error: "invoice_not_found",
      };
    }
  }

  await input.supabaseAdmin
    .from("portal_payment_intents")
    .update({
      stripe_payment_intent_id: intentId,
      status: "succeeded",
      succeeded_at: now,
      webhook_signature_verified: true,
      metadata: nextMetadata,
    })
    .eq("id", paymentIntent.id);
}
