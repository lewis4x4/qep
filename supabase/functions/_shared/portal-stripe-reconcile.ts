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
  invoice_reference?: string | null;
}

interface DepositDealRow {
  id: string;
  workspace_id: string | null;
  company_id: string | null;
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
    const { data, error } = await supabaseAdmin
      .from("portal_payment_intents")
      .select(
        "id, workspace_id, company_id, invoice_id, amount_cents, stripe_payment_intent_id, metadata",
      )
      .eq("stripe_payment_intent_id", stripePaymentIntentId)
      .maybeSingle();
    if (error) throw new Error(`Payment lookup failed: ${error.message}`);
    if (data) return data as PortalPaymentIntentRow;
  }

  if (checkoutSessionId) {
    const { data, error } = await supabaseAdmin
      .from("portal_payment_intents")
      .select(
        "id, workspace_id, company_id, invoice_id, amount_cents, stripe_payment_intent_id, metadata",
      )
      .contains("metadata", { checkout_session_id: checkoutSessionId })
      .maybeSingle();
    if (error) throw new Error(`Payment lookup failed: ${error.message}`);
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
      health_score_recompute_error: profileErr?.message ??
        "customer_profile_not_found",
    };
  }

  const { error: recomputeErr } = await input.supabaseAdmin.rpc(
    "compute_customer_health_score",
    {
      p_customer_profile_id: profileRow.id,
    },
  );

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
  const intentId = input.stripePaymentIntentId ??
    input.paymentIntent.stripe_payment_intent_id;
  const expectedAmountCents = input.paymentIntent.amount_cents > 0
    ? input.paymentIntent.amount_cents
    : 0;
  const webhookAmountCents = Math.max(0, input.fallbackAmountCents ?? 0);
  const amountCents = webhookAmountCents > 0
    ? webhookAmountCents
    : expectedAmountCents;
  const alreadyAppliedAt =
    typeof input.metadata.deposit_payment_applied_at === "string"
      ? input.metadata.deposit_payment_applied_at
      : null;
  let nextMetadata: Record<string, unknown> = {
    ...input.metadata,
    stripe_event_id: input.eventId,
  };
  let exceptionWorkspaceId =
    typeof input.paymentIntent.workspace_id === "string"
      ? input.paymentIntent.workspace_id
      : null;
  let exceptionDepositId: string | null = null;

  const depositId = typeof input.metadata.deposit_id === "string"
    ? input.metadata.deposit_id
    : "";
  if (!depositId) {
    nextMetadata = {
      ...nextMetadata,
      deposit_payment_blocked_reason: "missing_deposit_id",
    };
  } else if (!alreadyAppliedAt) {
    const { data: depositRow } = await input.supabaseAdmin
      .from("deposits")
      .select(
        "id, workspace_id, deal_id, required_amount, status, invoice_reference",
      )
      .eq("id", depositId)
      .maybeSingle();

    if (!depositRow) {
      nextMetadata = {
        ...nextMetadata,
        deposit_payment_blocked_reason: "deposit_not_found",
      };
    } else {
      const deposit = depositRow as DepositRow;
      exceptionWorkspaceId = deposit.workspace_id ?? exceptionWorkspaceId;
      exceptionDepositId = deposit.id;
      const { data: dealRow } = await input.supabaseAdmin
        .from("crm_deals")
        .select("id, workspace_id, company_id")
        .eq("id", deposit.deal_id)
        .maybeSingle();
      const deal = (dealRow ?? null) as DepositDealRow | null;
      const requiredCents = Math.round(
        Number(deposit.required_amount ?? 0) * 100,
      );
      const depositStatus = String(deposit.status ?? "");
      const missingWorkspace = !deposit.workspace_id;
      const missingIntentWorkspace = !input.paymentIntent.workspace_id;
      const dealMissing = !deal;
      const workspaceMismatch = Boolean(
        input.paymentIntent.workspace_id && deposit.workspace_id &&
          input.paymentIntent.workspace_id !== deposit.workspace_id,
      );
      const dealWorkspaceMismatch = Boolean(
        deal?.workspace_id !== deposit.workspace_id ||
          deal?.workspace_id !== input.paymentIntent.workspace_id,
      );
      const dealCompanyMismatch = Boolean(
        !input.paymentIntent.company_id || !deal?.company_id ||
          input.paymentIntent.company_id !== deal.company_id,
      );
      const stripeAmountMismatch = Boolean(
        webhookAmountCents > 0 && expectedAmountCents > 0 &&
          webhookAmountCents !== expectedAmountCents,
      );
      const depositAmountMismatch = amountCents !== requiredCents;
      const paymentReference = `stripe:${intentId}`;
      if (
        missingWorkspace || missingIntentWorkspace || dealMissing ||
        workspaceMismatch || dealWorkspaceMismatch || dealCompanyMismatch ||
        stripeAmountMismatch || depositAmountMismatch
      ) {
        nextMetadata = {
          ...nextMetadata,
          deposit_payment_blocked_reason: missingWorkspace
            ? "deposit_workspace_missing"
            : missingIntentWorkspace
            ? "payment_intent_workspace_missing"
            : dealMissing
            ? "deposit_deal_not_found"
            : workspaceMismatch
            ? "workspace_mismatch"
            : dealWorkspaceMismatch
            ? "deal_workspace_mismatch"
            : dealCompanyMismatch
            ? "deal_company_mismatch"
            : stripeAmountMismatch
            ? "stripe_amount_mismatch"
            : "deposit_amount_mismatch",
        };
      } else {
        const { error: receiptError } = await input.supabaseAdmin.rpc(
          "record_sale_deposit_receipt",
          {
            p_workspace_id: deposit.workspace_id,
            p_deposit_id: deposit.id,
            p_amount_cents: amountCents,
            p_payment_method: "credit_card",
            p_payment_reference: paymentReference,
            p_received_at: input.now,
            p_idempotency_key:
              `stripe-sale-deposit-receipt:${deposit.id}:${intentId}`,
          },
        );

        if (receiptError) {
          nextMetadata = {
            ...nextMetadata,
            deposit_payment_blocked_reason:
              "deposit_liability_reconciliation_failed",
            deposit_payment_reconciliation_error: receiptError.message,
          };
        } else {
          nextMetadata = {
            ...nextMetadata,
            deposit_payment_applied_at: input.now,
            ...(depositStatus !== "pending" && depositStatus !== "requested"
              ? { deposit_payment_recovered_at: input.now }
              : {}),
          };
          delete nextMetadata.deposit_payment_blocked_reason;
          delete nextMetadata.deposit_payment_reconciliation_error;
        }
      }
    }
  }

  const blockedReason =
    typeof nextMetadata.deposit_payment_blocked_reason === "string"
      ? nextMetadata.deposit_payment_blocked_reason
      : null;
  if (
    blockedReason && exceptionWorkspaceId &&
    typeof input.metadata.deposit_payment_exception_enqueued_at !== "string"
  ) {
    const { error: exceptionError } = await input.supabaseAdmin
      .from("exception_queue")
      .insert({
        workspace_id: exceptionWorkspaceId,
        source: "data_quality",
        severity: "critical",
        title: "Stripe deposit captured but liability receipt is blocked",
        detail:
          `Payment intent ${input.paymentIntent.id} succeeded but deposit reconciliation stopped: ${blockedReason}.`,
        payload: {
          exception_subtype: "stripe_sale_deposit_reconciliation",
          workspace_id: exceptionWorkspaceId,
          portal_payment_intent_id: input.paymentIntent.id,
          stripe_payment_intent_id: intentId,
          deposit_id: exceptionDepositId ?? (depositId || null),
          blocked_reason: blockedReason,
          amount_cents: amountCents,
        },
        entity_table: exceptionDepositId
          ? "deposits"
          : "portal_payment_intents",
        entity_id: exceptionDepositId ?? input.paymentIntent.id,
      });
    if (exceptionError && exceptionError.code !== "23505") {
      throw new Error(
        `failed to persist Stripe deposit reconciliation exception: ${exceptionError.message}`,
      );
    }
    if (!exceptionError || exceptionError.code === "23505") {
      nextMetadata = {
        ...nextMetadata,
        deposit_payment_exception_enqueued_at: input.now,
      };
    }
  }

  const { error: intentUpdateError } = await input.supabaseAdmin
    .from("portal_payment_intents")
    .update({
      stripe_payment_intent_id: intentId,
      status: "succeeded",
      succeeded_at: input.now,
      webhook_signature_verified: true,
      metadata: nextMetadata,
    })
    .eq("id", input.paymentIntent.id);
  if (intentUpdateError) {
    throw new Error(
      `failed to persist Stripe deposit reconciliation state: ${intentUpdateError.message}`,
    );
  }
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
    const { error } = await input.supabaseAdmin.rpc("enqueue_exception", {
      p_source: "stripe_mismatch",
      p_title: "Verified card payment needs reconciliation",
      p_severity: "error",
      p_detail: "No local intent matches the verified event. Recover the anchor before acknowledging delivery.",
      p_payload: { exception_subtype: "stripe_unmatched_payment", event_id: input.eventId, payment_intent_id: input.stripePaymentIntentId, checkout_session_id: input.checkoutSessionId },
      p_entity_table: "portal_payment_intents", p_entity_id: null,
    });
    throw new Error(error ? `Unmatched payment; exception persistence failed: ${error.message}` : "Unmatched verified payment retained for reconciliation; provider must retry");
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

  const intentId = input.stripePaymentIntentId ?? paymentIntent.stripe_payment_intent_id;
  const expectedCents = Number(paymentIntent.amount_cents);
  const capturedCents = input.fallbackAmountCents == null ? expectedCents : Number(input.fallbackAmountCents);
  let nextMetadata: Record<string, unknown> = { ...metadata, stripe_event_id: input.eventId };
  // An old marker alone is not proof: older versions could set it before any invoice write.
  delete nextMetadata.invoice_payment_applied_at;

  async function block(reason: string): Promise<never> {
    nextMetadata = { ...nextMetadata, invoice_payment_blocked_reason: reason, reconciliation_status: "blocked", provider_payment_captured: true, ...(/legacy|ambiguous/i.test(reason) ? { reconciliation_requires_manual: true } : {}) };
    const exceptionPayload = { exception_subtype: "stripe_invoice_reconciliation", event_id: input.eventId, portal_payment_intent_id: paymentIntent!.id,
      invoice_id: paymentIntent!.invoice_id, workspace_id: paymentIntent!.workspace_id, captured_amount_cents: capturedCents, blocked_reason: reason };
    let exceptionError: { message: string; code?: string } | null;
    if (paymentIntent!.workspace_id) {
      // The service-role caller has no user workspace claim: do not let the generic RPC default this to another workspace.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${paymentIntent!.workspace_id}:${input.eventId ?? intentId}:${reason}`));
      const hex = Array.from(new Uint8Array(digest)).slice(0,16).map(n => n.toString(16).padStart(2,"0")).join("");
      const exceptionId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      const result = await input.supabaseAdmin.from("exception_queue").insert({
        id: exceptionId, workspace_id: paymentIntent!.workspace_id, source: "stripe_mismatch",
        title: "Captured card payment needs invoice reconciliation", severity: "error", detail: `Invoice receipt is unapplied: ${reason}.`,
        payload: exceptionPayload, entity_table: "portal_payment_intents", entity_id: paymentIntent!.id,
      });
      exceptionError = result.error?.code === "23505" ? null : result.error;
    } else {
      const result = await input.supabaseAdmin.rpc("enqueue_exception", {
        p_source: "stripe_mismatch", p_title: "Captured card payment has no workspace anchor", p_severity: "error",
        p_detail: "Recover the local payment workspace before application.", p_payload: exceptionPayload,
        p_entity_table: "portal_payment_intents", p_entity_id: paymentIntent!.id,
      });
      exceptionError = result.error;
    }
    if (exceptionError) throw new Error(`Invoice reconciliation blocked (${reason}); exception persistence failed: ${exceptionError.message}`);
    const { data, error } = await input.supabaseAdmin.from("portal_payment_intents").update({
      stripe_payment_intent_id: intentId, status: "processing", webhook_signature_verified: true, metadata: nextMetadata,
    }).eq("id", paymentIntent!.id).select("id").maybeSingle();
    if (error || !data) throw new Error(`Invoice reconciliation blocked (${reason}); state persistence failed: ${error?.message ?? "intent missing"}`);
    throw new Error(`Invoice reconciliation blocked: ${reason}; provider must retry`);
  }

  if (!paymentIntent.invoice_id) return await block("invoice_anchor_missing");
  if (!paymentIntent.workspace_id || !paymentIntent.company_id) return await block("payment_scope_missing");
  if (!Number.isSafeInteger(expectedCents) || expectedCents <= 0 || !Number.isSafeInteger(capturedCents) || capturedCents <= 0) return await block("invalid_payment_amount");
  if (capturedCents !== expectedCents) return await block("stripe_amount_mismatch");

  const { data: invoiceRow, error: invoiceLookupError } = await input.supabaseAdmin.from("customer_invoices")
    .select("id, workspace_id, total, amount_paid, status, paid_at, payment_reference, crm_company_id")
    .eq("id", paymentIntent.invoice_id).maybeSingle();
  if (invoiceLookupError) throw new Error(`Invoice lookup failed: ${invoiceLookupError.message}`);
  if (!invoiceRow) return await block("invoice_not_found");
  const invoice = invoiceRow as PortalInvoiceRow;
  if (invoice.workspace_id !== paymentIntent.workspace_id) return await block("workspace_mismatch");
  if (!invoice.crm_company_id || invoice.crm_company_id !== paymentIntent.company_id) return await block("company_mismatch");
  const reference = `stripe:${intentId}`;
  const { data: receipt, error: receiptError } = await input.supabaseAdmin.rpc("apply_stripe_invoice_receipt", {
    p_intent_id: paymentIntent.id, p_provider_payment_id: intentId, p_captured_amount_cents: capturedCents, p_event_id: input.eventId,
  });
  if (receiptError) return await block(receiptError.message);
  if (!receipt || typeof receipt.payment_id !== "string" || receipt.applied_cents !== capturedCents) throw new Error("Provider receipt transaction returned no matching immutable receipt; retry");
  nextMetadata = { ...nextMetadata, invoice_payment_applied_at: receipt.received_at ?? now,
    invoice_payment_reference: reference, invoice_payment_applied_cents: capturedCents, customer_payment_id: receipt.payment_id,
    reconciliation_status: "applied" };
  delete nextMetadata.invoice_payment_blocked_reason;
  delete nextMetadata.reconciliation_requires_manual;
  nextMetadata = await recomputeHealthScoreForInvoice({ supabaseAdmin: input.supabaseAdmin, invoice, metadata: nextMetadata, now });
  const { data: persistedIntent, error: paymentIntentUpdateError } = await input.supabaseAdmin.from("portal_payment_intents").update({
    stripe_payment_intent_id: intentId, status: "succeeded", succeeded_at: now, webhook_signature_verified: true, metadata: nextMetadata,
  }).eq("id", paymentIntent.id).select("id").maybeSingle();
  if (paymentIntentUpdateError || !persistedIntent) throw new Error(`failed to persist Stripe invoice reconciliation state: ${paymentIntentUpdateError?.message ?? "intent missing"}`);
}
