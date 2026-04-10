import { assertEquals } from "jsr:@std/assert@1";
import { reconcileSucceededPayment } from "./portal-stripe-reconcile.ts";

function createMockSupabase(options: {
  paymentIntent?: Record<string, unknown> | null;
  invoice?: Record<string, unknown> | null;
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
      invoice_id: "invoice-1",
      amount_cents: 10000,
      stripe_payment_intent_id: "pi_1",
      metadata: {},
    },
    invoice: {
      id: "invoice-1",
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
      invoice_id: "invoice-1",
      amount_cents: 10000,
      stripe_payment_intent_id: "pi_1",
      metadata: {},
    },
    invoice: {
      id: "invoice-1",
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
