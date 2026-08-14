import { assertEquals } from "jsr:@std/assert@1";
import { reconcileSucceededPayment } from "./portal-stripe-reconcile.ts";

function createMockSupabase(options: {
  paymentIntent?: Record<string, unknown> | null;
  invoice?: Record<string, unknown> | null;
  rentalInvoice?: Record<string, unknown> | null;
  deposit?: Record<string, unknown> | null;
  deal?: Record<string, unknown> | null;
  customerProfile?: Record<string, unknown> | null;
  recomputeError?: { message: string } | null;
  receiptError?: { message: string; code?: string } | null;
  commissionError?: { message: string; code?: string } | null;
  exceptionInsertError?: { message: string; code?: string } | null;
  updateErrors?: Record<string, { message: string; code?: string } | null>;
}) {
  const calls: Array<
    { type: string; table?: string; args?: Record<string, unknown> }
  > = [];

  const client = {
    calls,
    from(table: string) {
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              return {
                contains() {
                  return {
                    maybeSingle: async () => ({
                      data: options.paymentIntent ?? null,
                      error: null,
                    }),
                  };
                },
                limit() {
                  return {
                    maybeSingle: async () => {
                      if (table === "customer_profiles_extended") {
                        return {
                          data: options.customerProfile ?? null,
                          error: null,
                        };
                      }
                      return { data: null, error: null };
                    },
                  };
                },
                maybeSingle: async () => {
                  if (table === "portal_payment_intents") {
                    return { data: options.paymentIntent ?? null, error: null };
                  }
                  if (table === "customer_invoices") {
                    return { data: options.invoice ?? null, error: null };
                  }
                  if (table === "rental_invoices") {
                    return { data: options.rentalInvoice ?? null, error: null };
                  }
                  if (table === "deposits") {
                    return { data: options.deposit ?? null, error: null };
                  }
                  if (table === "crm_deals") {
                    return {
                      data: options.deal ?? (options.deposit
                        ? {
                          id: options.deposit.deal_id,
                          workspace_id: options.deposit.workspace_id,
                          company_id: options.paymentIntent?.company_id ?? null,
                        }
                        : null),
                      error: null,
                    };
                  }
                  return { data: null, error: null };
                },
              };
            },
            contains() {
              return {
                maybeSingle: async () => ({
                  data: options.paymentIntent ?? null,
                  error: null,
                }),
              };
            },
          };
        },
        update(args: Record<string, unknown>) {
          calls.push({ type: "update", table, args });
          return {
            eq: async () => ({ error: options.updateErrors?.[table] ?? null }),
          };
        },
        insert(args: Record<string, unknown>) {
          calls.push({ type: "insert", table, args });
          return Promise.resolve({
            error: table === "exception_queue"
              ? options.exceptionInsertError ?? null
              : null,
          });
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ type: "rpc", args: { fn, ...args } });
      return Promise.resolve({
        error: fn === "record_sale_deposit_receipt"
          ? options.receiptError ?? null
          : fn === "rental_activate_paid_invoice_commission"
          ? options.commissionError ?? null
          : options.recomputeError ?? null,
      });
    },
  };

  return client;
}

async function assertRejectsWith(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assertEquals(
      String(error).includes(expectedMessage),
      true,
    );
    return;
  }
  throw new Error(`expected rejection containing: ${expectedMessage}`);
}

Deno.test("reconcileSucceededPayment recomputes health score once when company profile resolves", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-1",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: "invoice-1",
      amount_cents: 10000,
      stripe_payment_intent_id: "pi_1",
      metadata: {},
    },
    invoice: {
      id: "invoice-1",
      workspace_id: "workspace-1",
      total: 100,
      amount_paid: 0,
      status: "sent",
      paid_at: null,
      payment_reference: null,
      crm_company_id: "company-1",
    },
    customerProfile: { id: "profile-1" },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_1",
    stripePaymentIntentId: "pi_1",
    checkoutSessionId: null,
    fallbackAmountCents: null,
  });

  const recomputeCalls = supabase.calls.filter((call) => call.type === "rpc");
  assertEquals(recomputeCalls.length, 1);
  assertEquals(recomputeCalls[0].args?.fn, "compute_customer_health_score");
  assertEquals(recomputeCalls[0].args?.p_customer_profile_id, "profile-1");
});

Deno.test("reconcileSucceededPayment is fail-soft when recompute errors", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-1",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: "invoice-1",
      amount_cents: 10000,
      stripe_payment_intent_id: "pi_1",
      metadata: {},
    },
    invoice: {
      id: "invoice-1",
      workspace_id: "workspace-1",
      total: 100,
      amount_paid: 0,
      status: "sent",
      paid_at: null,
      payment_reference: null,
      crm_company_id: "company-1",
    },
    customerProfile: { id: "profile-1" },
    recomputeError: { message: "rpc failed" },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_1",
    stripePaymentIntentId: "pi_1",
    checkoutSessionId: null,
    fallbackAmountCents: null,
  });

  const paymentIntentUpdate = supabase.calls.find((call) =>
    call.type === "update" && call.table === "portal_payment_intents"
  );
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)
      ?.health_score_recompute_error,
    "rpc failed",
  );
});

Deno.test("reconcileSucceededPayment blocks underpaid invoice application", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-1",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: "invoice-1",
      amount_cents: 100,
      stripe_payment_intent_id: "pi_1",
      metadata: {},
    },
    invoice: {
      id: "invoice-1",
      workspace_id: "workspace-1",
      total: 100,
      amount_paid: 0,
      status: "sent",
      paid_at: null,
      payment_reference: null,
      crm_company_id: "company-1",
    },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_1",
    stripePaymentIntentId: "pi_1",
    checkoutSessionId: null,
    fallbackAmountCents: null,
  });

  const invoiceUpdates = supabase.calls.filter((call) =>
    call.type === "update" && call.table === "customer_invoices"
  );
  const paymentIntentUpdate = supabase.calls.find((call) =>
    call.type === "update" && call.table === "portal_payment_intents"
  );
  assertEquals(invoiceUpdates.length, 0);
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)
      ?.invoice_payment_blocked_reason,
    "amount_below_invoice_balance",
  );
});

Deno.test("reconcileSucceededPayment activates a mapped rental commission from verified Stripe evidence", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-rental",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: "invoice-rental",
      amount_cents: 10000,
      stripe_payment_intent_id: "pi_rental",
      metadata: {},
    },
    invoice: {
      id: "invoice-rental",
      workspace_id: "workspace-1",
      total: 100,
      amount_paid: 0,
      status: "sent",
      paid_at: null,
      payment_reference: null,
      crm_company_id: "company-1",
    },
    rentalInvoice: { id: "rental-invoice-1" },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_rental",
    stripePaymentIntentId: "pi_rental",
    checkoutSessionId: null,
    fallbackAmountCents: null,
  });

  const activation = supabase.calls.find((call) =>
    call.type === "rpc" && call.args?.fn === "rental_activate_paid_invoice_commission"
  );
  assertEquals(activation?.args, {
    fn: "rental_activate_paid_invoice_commission",
    p_workspace_id: "workspace-1",
    p_rental_invoice_id: "rental-invoice-1",
    p_payment_source_kind: "stripe_payment_intent",
    p_payment_source_id: "intent-row-rental",
    p_actor_id: null,
  });
});

Deno.test("reconcileSucceededPayment fails closed when mapped rental commission activation fails", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-rental",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: "invoice-rental",
      amount_cents: 10000,
      stripe_payment_intent_id: "pi_rental",
      metadata: {},
    },
    invoice: {
      id: "invoice-rental",
      workspace_id: "workspace-1",
      total: 100,
      amount_paid: 0,
      status: "sent",
      paid_at: null,
      payment_reference: null,
      crm_company_id: "company-1",
    },
    rentalInvoice: { id: "rental-invoice-1" },
    commissionError: { message: "commission split is missing" },
  });

  await assertRejectsWith(
    () => reconcileSucceededPayment({
      supabaseAdmin: supabase as never,
      eventId: "evt_rental",
      stripePaymentIntentId: "pi_rental",
      checkoutSessionId: null,
      fallbackAmountCents: null,
    }),
    "failed to activate rental commission from Stripe payment",
  );
});

Deno.test("reconcileSucceededPayment records quote deposits through the atomic liability RPC", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-1",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: null,
      amount_cents: 50000,
      stripe_payment_intent_id: "cs_test_1",
      metadata: {
        payment_kind: "quote_deposit",
        deposit_id: "deposit-1",
        checkout_session_id: "cs_test_1",
      },
    },
    deposit: {
      id: "deposit-1",
      workspace_id: "workspace-1",
      deal_id: "deal-1",
      required_amount: 500,
      status: "requested",
    },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_1",
    stripePaymentIntentId: "pi_1",
    checkoutSessionId: "cs_test_1",
    fallbackAmountCents: null,
  });

  const receiptCall = supabase.calls.find((call) =>
    call.type === "rpc" && call.args?.fn === "record_sale_deposit_receipt"
  );
  const paymentIntentUpdate = supabase.calls.find((call) =>
    call.type === "update" && call.table === "portal_payment_intents"
  );

  assertEquals(receiptCall?.args?.p_workspace_id, "workspace-1");
  assertEquals(receiptCall?.args?.p_deposit_id, "deposit-1");
  assertEquals(receiptCall?.args?.p_amount_cents, 50000);
  assertEquals(receiptCall?.args?.p_payment_method, "credit_card");
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "update" && call.table === "deposits"
    ),
    false,
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "update" && call.table === "crm_deals"
    ),
    false,
  );
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)
      .deposit_payment_applied_at != null,
    true,
  );
});

Deno.test("reconcileSucceededPayment does not reapply duplicate quote deposit webhooks", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-1",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: null,
      amount_cents: 50000,
      stripe_payment_intent_id: "pi_1",
      metadata: {
        payment_kind: "quote_deposit",
        deposit_id: "deposit-1",
        deposit_payment_applied_at: "2026-05-20T20:00:00.000Z",
      },
    },
    deposit: {
      id: "deposit-1",
      workspace_id: "workspace-1",
      deal_id: "deal-1",
      required_amount: 500,
      status: "verified",
    },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_2",
    stripePaymentIntentId: "pi_1",
    checkoutSessionId: null,
    fallbackAmountCents: null,
  });

  assertEquals(
    supabase.calls.some((call) =>
      call.type === "update" && call.table === "deposits"
    ),
    false,
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "update" && call.table === "crm_deals"
    ),
    false,
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "update" && call.table === "portal_payment_intents"
    ),
    true,
  );
});

Deno.test("reconcileSucceededPayment blocks quote deposit when verified Stripe amount mismatches expected amount", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-1",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: null,
      amount_cents: 50000,
      stripe_payment_intent_id: "pi_1",
      metadata: {
        payment_kind: "quote_deposit",
        deposit_id: "deposit-1",
      },
    },
    deposit: {
      id: "deposit-1",
      workspace_id: "workspace-1",
      deal_id: "deal-1",
      required_amount: 500,
      status: "requested",
    },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_1",
    stripePaymentIntentId: "pi_1",
    checkoutSessionId: null,
    fallbackAmountCents: 100,
  });

  const paymentIntentUpdate = supabase.calls.find((call) =>
    call.type === "update" && call.table === "portal_payment_intents"
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "update" && call.table === "deposits"
    ),
    false,
  );
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)
      ?.deposit_payment_blocked_reason,
    "stripe_amount_mismatch",
  );
});

Deno.test("reconcileSucceededPayment blocks cross-company deposit evidence and raises a finance exception", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-company-mismatch",
      workspace_id: "workspace-1",
      company_id: "company-intent",
      invoice_id: null,
      amount_cents: 50000,
      stripe_payment_intent_id: "pi_company_mismatch",
      metadata: { payment_kind: "quote_deposit", deposit_id: "deposit-1" },
    },
    deposit: {
      id: "deposit-1",
      workspace_id: "workspace-1",
      deal_id: "deal-1",
      required_amount: 500,
      status: "requested",
    },
    deal: {
      id: "deal-1",
      workspace_id: "workspace-1",
      company_id: "company-deal",
    },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_company_mismatch",
    stripePaymentIntentId: "pi_company_mismatch",
    checkoutSessionId: null,
    fallbackAmountCents: 50000,
  });

  const paymentIntentUpdate = supabase.calls.find((call) =>
    call.type === "update" && call.table === "portal_payment_intents"
  );
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)
      ?.deposit_payment_blocked_reason,
    "deal_company_mismatch",
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "insert" && call.table === "exception_queue"
    ),
    true,
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "rpc" && call.args?.fn === "record_sale_deposit_receipt"
    ),
    false,
  );
});

Deno.test("reconcileSucceededPayment blocks a second quote deposit checkout after deposit is already verified", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-2",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: null,
      amount_cents: 50000,
      stripe_payment_intent_id: "pi_2",
      metadata: {
        payment_kind: "quote_deposit",
        deposit_id: "deposit-1",
      },
    },
    deposit: {
      id: "deposit-1",
      workspace_id: "workspace-1",
      deal_id: "deal-1",
      required_amount: 500,
      status: "verified",
    },
    receiptError: {
      message: "sale deposit receipt already exists with different payment evidence",
    },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_3",
    stripePaymentIntentId: "pi_2",
    checkoutSessionId: null,
    fallbackAmountCents: 50000,
  });

  const paymentIntentUpdate = supabase.calls.find((call) =>
    call.type === "update" && call.table === "portal_payment_intents"
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "rpc" && call.args?.fn === "record_sale_deposit_receipt"
    ),
    true,
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "update" && call.table === "crm_deals"
    ),
    false,
  );
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)
      ?.deposit_payment_blocked_reason,
    "deposit_liability_reconciliation_failed",
  );
});

Deno.test("reconcileSucceededPayment blocks quote deposit webhook when the atomic receipt RPC rejects a terminal refund state", async () => {
  for (const status of ["refund_requested", "refunded"]) {
    const supabase = createMockSupabase({
      paymentIntent: {
        id: `intent-row-${status}`,
        workspace_id: "workspace-1",
        company_id: "company-1",
        invoice_id: null,
        amount_cents: 50000,
        stripe_payment_intent_id: `pi_${status}`,
        metadata: {
          payment_kind: "quote_deposit",
          deposit_id: "deposit-1",
        },
      },
      deposit: {
        id: "deposit-1",
        workspace_id: "workspace-1",
        deal_id: "deal-1",
        required_amount: 500,
        status,
      },
      receiptError: {
        message: `sale deposit status ${status} cannot receive money`,
      },
    });

    await reconcileSucceededPayment({
      supabaseAdmin: supabase as never,
      eventId: `evt_${status}`,
      stripePaymentIntentId: `pi_${status}`,
      checkoutSessionId: null,
      fallbackAmountCents: 50000,
    });

    const paymentIntentUpdate = supabase.calls.find((call) =>
      call.type === "update" && call.table === "portal_payment_intents"
    );
    assertEquals(
      supabase.calls.some((call) =>
        call.type === "rpc" && call.args?.fn === "record_sale_deposit_receipt"
      ),
      true,
    );
    assertEquals(
      supabase.calls.some((call) =>
        call.type === "update" && call.table === "crm_deals"
      ),
      false,
    );
    assertEquals(
      (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)
        ?.deposit_payment_blocked_reason,
      "deposit_liability_reconciliation_failed",
    );
  }
});

Deno.test("reconcileSucceededPayment recovers an exact Stripe receipt after later invoice application changed deposit state", async () => {
  for (const status of ["partially_applied", "applied"]) {
    const supabase = createMockSupabase({
      paymentIntent: {
        id: `intent-row-recovery-${status}`,
        workspace_id: "workspace-1",
        company_id: "company-1",
        invoice_id: null,
        amount_cents: 50000,
        stripe_payment_intent_id: "pi_original",
        metadata: { payment_kind: "quote_deposit", deposit_id: "deposit-1" },
      },
      deposit: {
        id: "deposit-1",
        workspace_id: "workspace-1",
        deal_id: "deal-1",
        required_amount: 500,
        status,
        invoice_reference: "01-E00001",
      },
    });

    await reconcileSucceededPayment({
      supabaseAdmin: supabase as never,
      eventId: `evt_recovery_${status}`,
      stripePaymentIntentId: "pi_original",
      checkoutSessionId: null,
      fallbackAmountCents: 50000,
    });

    const paymentIntentUpdate = supabase.calls.find((call) =>
      call.type === "update" && call.table === "portal_payment_intents"
    );
    const metadata = paymentIntentUpdate?.args?.metadata as Record<string, unknown>;
    assertEquals(
      supabase.calls.some((call) =>
        call.type === "rpc" && call.args?.fn === "record_sale_deposit_receipt"
      ),
      true,
    );
    assertEquals(metadata.deposit_payment_applied_at != null, true);
    assertEquals(metadata.deposit_payment_recovered_at != null, true);
    assertEquals(metadata.deposit_payment_blocked_reason, undefined);
  }
});

Deno.test("reconcileSucceededPayment treats the durable exception unique-key conflict as an idempotent retry", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-deduped-exception",
      workspace_id: "workspace-1",
      company_id: "company-intent",
      invoice_id: null,
      amount_cents: 50000,
      stripe_payment_intent_id: "pi_deduped_exception",
      metadata: { payment_kind: "quote_deposit", deposit_id: "deposit-1" },
    },
    deposit: {
      id: "deposit-1",
      workspace_id: "workspace-1",
      deal_id: "deal-1",
      required_amount: 500,
      status: "requested",
    },
    deal: {
      id: "deal-1",
      workspace_id: "workspace-1",
      company_id: "company-deal",
    },
    exceptionInsertError: {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    },
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_deduped_exception",
    stripePaymentIntentId: "pi_deduped_exception",
    checkoutSessionId: null,
    fallbackAmountCents: 50000,
  });

  const paymentIntentUpdate = supabase.calls.find((call) =>
    call.type === "update" && call.table === "portal_payment_intents"
  );
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)
      .deposit_payment_exception_enqueued_at != null,
    true,
  );
});

Deno.test("reconcileSucceededPayment fails the webhook when a non-duplicate critical exception cannot persist", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-exception-write-failure",
      workspace_id: "workspace-1",
      company_id: "company-intent",
      invoice_id: null,
      amount_cents: 50000,
      stripe_payment_intent_id: "pi_exception_write_failure",
      metadata: { payment_kind: "quote_deposit", deposit_id: "deposit-1" },
    },
    deposit: {
      id: "deposit-1",
      workspace_id: "workspace-1",
      deal_id: "deal-1",
      required_amount: 500,
      status: "requested",
    },
    deal: {
      id: "deal-1",
      workspace_id: "workspace-1",
      company_id: "company-deal",
    },
    exceptionInsertError: {
      code: "08006",
      message: "database connection failed",
    },
  });

  await assertRejectsWith(
    () => reconcileSucceededPayment({
      supabaseAdmin: supabase as never,
      eventId: "evt_exception_write_failure",
      stripePaymentIntentId: "pi_exception_write_failure",
      checkoutSessionId: null,
      fallbackAmountCents: 50000,
    }),
    "failed to persist Stripe deposit reconciliation exception",
  );
});

Deno.test("reconcileSucceededPayment fails the webhook when final intent state cannot persist", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-final-write-failure",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: null,
      amount_cents: 50000,
      stripe_payment_intent_id: "pi_final_write_failure",
      metadata: { payment_kind: "quote_deposit", deposit_id: "deposit-1" },
    },
    deposit: {
      id: "deposit-1",
      workspace_id: "workspace-1",
      deal_id: "deal-1",
      required_amount: 500,
      status: "requested",
    },
    updateErrors: {
      portal_payment_intents: {
        code: "08006",
        message: "database connection failed",
      },
    },
  });

  await assertRejectsWith(
    () => reconcileSucceededPayment({
      supabaseAdmin: supabase as never,
      eventId: "evt_final_write_failure",
      stripePaymentIntentId: "pi_final_write_failure",
      checkoutSessionId: null,
      fallbackAmountCents: 50000,
    }),
    "failed to persist Stripe deposit reconciliation state",
  );
});

Deno.test("reconcileSucceededPayment fails before success metadata when invoice application cannot persist", async () => {
  const supabase = createMockSupabase({
    paymentIntent: {
      id: "intent-row-invoice-write-failure",
      workspace_id: "workspace-1",
      company_id: "company-1",
      invoice_id: "invoice-1",
      amount_cents: 10000,
      stripe_payment_intent_id: "pi_invoice_write_failure",
      metadata: {},
    },
    invoice: {
      id: "invoice-1",
      workspace_id: "workspace-1",
      total: 100,
      amount_paid: 0,
      status: "sent",
      paid_at: null,
      payment_reference: null,
      crm_company_id: "company-1",
    },
    updateErrors: {
      customer_invoices: {
        code: "40001",
        message: "serialization failure",
      },
    },
  });

  await assertRejectsWith(
    () => reconcileSucceededPayment({
      supabaseAdmin: supabase as never,
      eventId: "evt_invoice_write_failure",
      stripePaymentIntentId: "pi_invoice_write_failure",
      checkoutSessionId: null,
      fallbackAmountCents: 10000,
    }),
    "failed to apply Stripe payment to customer invoice",
  );
  assertEquals(
    supabase.calls.some((call) =>
      call.type === "update" && call.table === "portal_payment_intents"
    ),
    false,
  );
});
