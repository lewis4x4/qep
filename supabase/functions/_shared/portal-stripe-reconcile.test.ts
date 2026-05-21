import { assertEquals } from "jsr:@std/assert@1";
import { reconcileSucceededPayment } from "./portal-stripe-reconcile.ts";

function createMockSupabase(options: {
  paymentIntent?: Record<string, unknown> | null;
  invoice?: Record<string, unknown> | null;
  deposit?: Record<string, unknown> | null;
  customerProfile?: Record<string, unknown> | null;
  recomputeError?: { message: string } | null;
}) {
  const calls: Array<{ type: string; table?: string; args?: Record<string, unknown> }> = [];

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
                    maybeSingle: async () => ({ data: options.paymentIntent ?? null, error: null }),
                  };
                },
                limit() {
                  return {
                    maybeSingle: async () => {
                      if (table === "customer_profiles_extended") {
                        return { data: options.customerProfile ?? null, error: null };
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
                  if (table === "deposits") {
                    return { data: options.deposit ?? null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
            contains() {
              return {
                maybeSingle: async () => ({ data: options.paymentIntent ?? null, error: null }),
              };
            },
          };
        },
        update(args: Record<string, unknown>) {
          calls.push({ type: "update", table, args });
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ type: "rpc", args: { fn, ...args } });
      return Promise.resolve({ error: options.recomputeError ?? null });
    },
  };

  return client;
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
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)?.health_score_recompute_error,
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
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)?.invoice_payment_blocked_reason,
    "amount_below_invoice_balance",
  );
});

Deno.test("reconcileSucceededPayment verifies quote deposit payments and updates the deal gate", async () => {
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

  const depositUpdate = supabase.calls.find((call) => call.type === "update" && call.table === "deposits");
  const dealUpdate = supabase.calls.find((call) => call.type === "update" && call.table === "crm_deals");
  const paymentIntentUpdate = supabase.calls.find((call) => call.type === "update" && call.table === "portal_payment_intents");

  assertEquals(depositUpdate?.args?.status, "verified");
  assertEquals(depositUpdate?.args?.payment_method, "credit_card");
  assertEquals(dealUpdate?.args?.deposit_status, "verified");
  assertEquals((paymentIntentUpdate?.args?.metadata as Record<string, unknown>).deposit_payment_applied_at != null, true);
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

  assertEquals(supabase.calls.some((call) => call.type === "update" && call.table === "deposits"), false);
  assertEquals(supabase.calls.some((call) => call.type === "update" && call.table === "crm_deals"), false);
  assertEquals(supabase.calls.some((call) => call.type === "update" && call.table === "portal_payment_intents"), true);
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

  const paymentIntentUpdate = supabase.calls.find((call) => call.type === "update" && call.table === "portal_payment_intents");
  assertEquals(supabase.calls.some((call) => call.type === "update" && call.table === "deposits"), false);
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)?.deposit_payment_blocked_reason,
    "stripe_amount_mismatch",
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
  });

  await reconcileSucceededPayment({
    supabaseAdmin: supabase as never,
    eventId: "evt_3",
    stripePaymentIntentId: "pi_2",
    checkoutSessionId: null,
    fallbackAmountCents: 50000,
  });

  const paymentIntentUpdate = supabase.calls.find((call) => call.type === "update" && call.table === "portal_payment_intents");
  assertEquals(supabase.calls.some((call) => call.type === "update" && call.table === "deposits"), false);
  assertEquals(supabase.calls.some((call) => call.type === "update" && call.table === "crm_deals"), false);
  assertEquals(
    (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)?.deposit_payment_blocked_reason,
    "deposit_already_verified",
  );
});

Deno.test("reconcileSucceededPayment blocks quote deposit webhook when deposit status is no longer collectible", async () => {
  for (const status of ["received", "applied", "refund_requested", "refunded"]) {
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
    });

    await reconcileSucceededPayment({
      supabaseAdmin: supabase as never,
      eventId: `evt_${status}`,
      stripePaymentIntentId: `pi_${status}`,
      checkoutSessionId: null,
      fallbackAmountCents: 50000,
    });

    const paymentIntentUpdate = supabase.calls.find((call) => call.type === "update" && call.table === "portal_payment_intents");
    assertEquals(supabase.calls.some((call) => call.type === "update" && call.table === "deposits"), false);
    assertEquals(supabase.calls.some((call) => call.type === "update" && call.table === "crm_deals"), false);
    assertEquals(
      (paymentIntentUpdate?.args?.metadata as Record<string, unknown>)?.deposit_payment_blocked_reason,
      status === "applied" ? "deposit_already_verified" : "deposit_status_not_collectible",
    );
  }
});
