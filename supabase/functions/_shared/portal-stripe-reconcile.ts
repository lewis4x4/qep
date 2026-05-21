import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface PortalPaymentIntentRow {
  id: string;
  workspace_id: string | null;
  company_id: string | null;
  invoice_id: string | null;
  amount_cents: number;
  stripe_payment_intent_id: string;
  metadata: Record<string, unknown> | null;
}

export interface PortalInvoiceRow {
  id: string;
  workspace_id: string | null;
  total: number;
  amount_paid: number | null;
  status: string;
  paid_at: string | null;
  payment_reference: string | null;
  crm_company_id?: string | null;
}

export interface DepositRow {
  id: string;
  workspace_id: string | null;
  deal_id: string | null;
  required_amount: number;
  status: string;
}

const COLLECTIBLE_DEPOSIT_STATUSES = new Set(["pending", "requested"]);
const PAID_DEPOSIT_STATUSES = new Set(["verified", "applied"]);

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
      .select("id, workspace_id, company_id, invoice_id, amount_cents, stripe_payment_intent_id, metadata")
      .eq("stripe_payment_intent_id", stripePaymentIntentId)
      .maybeSingle();
    if (data) return data as PortalPaymentIntentRow;
  }

  if (checkoutSessionId) {
    const { data } = await supabaseAdmin
      .from("portal_payment_intents")
      .select("id, workspace_id, company_id, invoice_id, amount_cents, stripe_payment_intent_id, metadata")
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

async function reconcileSucceededDepositPayment(input: {
  supabaseAdmin: SupabaseClient;
  paymentIntent: PortalPaymentIntentRow;
  metadata: Record<string, unknown>;
  eventId: string | null;
  stripePaymentIntentId: string | null;
  fallbackAmountCents: number | null;
  now: string;
}): Promise<void> {
  const intentId = input.stripePaymentIntentId ?? input.paymentIntent.stripe_payment_intent_id;
  const expectedAmountCents = input.paymentIntent.amount_cents > 0 ? input.paymentIntent.amount_cents : 0;
  const webhookAmountCents = Math.max(0, input.fallbackAmountCents ?? 0);
  const amountCents = webhookAmountCents > 0 ? webhookAmountCents : expectedAmountCents;
  const alreadyAppliedAt = typeof input.metadata.deposit_payment_applied_at === "string"
    ? input.metadata.deposit_payment_applied_at
    : null;
  let nextMetadata: Record<string, unknown> = {
    ...input.metadata,
    stripe_event_id: input.eventId,
  };

  const depositId = typeof input.metadata.deposit_id === "string" ? input.metadata.deposit_id : "";
  if (!depositId) {
    nextMetadata = { ...nextMetadata, deposit_payment_blocked_reason: "missing_deposit_id" };
  } else if (!alreadyAppliedAt) {
    const { data: depositRow } = await input.supabaseAdmin
      .from("deposits")
      .select("id, workspace_id, deal_id, required_amount, status")
      .eq("id", depositId)
      .maybeSingle();

    if (!depositRow) {
      nextMetadata = { ...nextMetadata, deposit_payment_blocked_reason: "deposit_not_found" };
    } else {
      const deposit = depositRow as DepositRow;
      const requiredCents = Math.round(Number(deposit.required_amount ?? 0) * 100);
      const depositStatus = String(deposit.status ?? "");
      const workspaceMismatch = Boolean(input.paymentIntent.workspace_id && deposit.workspace_id && input.paymentIntent.workspace_id !== deposit.workspace_id);
      const stripeAmountMismatch = Boolean(webhookAmountCents > 0 && expectedAmountCents > 0 && webhookAmountCents !== expectedAmountCents);
      const underpaid = amountCents < requiredCents;
      const statusNotCollectible = !COLLECTIBLE_DEPOSIT_STATUSES.has(depositStatus);
      if (workspaceMismatch || stripeAmountMismatch || underpaid || statusNotCollectible) {
        nextMetadata = {
          ...nextMetadata,
          deposit_payment_blocked_reason: workspaceMismatch
            ? "workspace_mismatch"
            : stripeAmountMismatch
              ? "stripe_amount_mismatch"
              : underpaid
                ? "amount_below_deposit_required"
                : PAID_DEPOSIT_STATUSES.has(depositStatus)
                  ? "deposit_already_verified"
                  : "deposit_status_not_collectible",
        };
      } else {
        await input.supabaseAdmin
          .from("deposits")
          .update({
            status: "verified",
            payment_method: "credit_card",
            received_at: input.now,
            verified_at: input.now,
            invoice_reference: `stripe:${intentId}`,
          })
          .eq("id", deposit.id);

        if (deposit.deal_id) {
          await input.supabaseAdmin
            .from("crm_deals")
            .update({
              deposit_status: "verified",
              deposit_amount: deposit.required_amount,
            })
            .eq("id", deposit.deal_id);
        }

        nextMetadata = {
          ...nextMetadata,
          deposit_payment_applied_at: input.now,
        };
        delete nextMetadata.deposit_payment_blocked_reason;
      }
    }
  }

  await input.supabaseAdmin
    .from("portal_payment_intents")
    .update({
      stripe_payment_intent_id: intentId,
      status: "succeeded",
      succeeded_at: input.now,
      webhook_signature_verified: true,
      metadata: nextMetadata,
    })
    .eq("id", input.paymentIntent.id);
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
  if (metadata.payment_kind === "quote_deposit") {
    await reconcileSucceededDepositPayment({
      supabaseAdmin: input.supabaseAdmin,
      paymentIntent,
      metadata,
      eventId: input.eventId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      fallbackAmountCents: input.fallbackAmountCents,
      now,
    });
    return;
  }

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
      .select("id, workspace_id, total, amount_paid, status, paid_at, payment_reference, crm_company_id")
      .eq("id", paymentIntent.invoice_id)
      .maybeSingle();

    if (invoiceRow) {
      const invoice = invoiceRow as PortalInvoiceRow;
      const currentAmountPaid = Number(invoice.amount_paid ?? 0);
      const invoiceTotal = Number(invoice.total ?? 0);
      const balance = Math.max(invoiceTotal - currentAmountPaid, 0);
      const balanceCents = Math.round(balance * 100);
      const workspaceMismatch = paymentIntent.workspace_id && invoice.workspace_id && paymentIntent.workspace_id !== invoice.workspace_id;
      const companyMismatch = paymentIntent.company_id && invoice.crm_company_id && paymentIntent.company_id !== invoice.crm_company_id;
      const underpaid = amountCents < balanceCents;
      if (workspaceMismatch || companyMismatch || underpaid) {
        nextMetadata = {
          ...nextMetadata,
          invoice_payment_blocked_reason: workspaceMismatch
            ? "workspace_mismatch"
            : companyMismatch
              ? "company_mismatch"
              : "amount_below_invoice_balance",
        };
      } else if (balance > 0) {
        const amount = amountCents / 100;
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
