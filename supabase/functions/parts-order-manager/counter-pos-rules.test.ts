import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertCounterReleaseAllowed,
  CounterPosRuleError,
  normalizeCounterTenderInput,
} from "./counter-pos-rules.ts";

Deno.test("counter POS release blocks unpaid cash-class tickets", () => {
  assertThrows(
    () =>
      assertCounterReleaseAllowed({
        order_source: "counter",
        status: "submitted",
        payment_classification: "cash",
        payment_status: "unpaid",
        charge_authorization_status: "not_applicable",
      }),
    CounterPosRuleError,
    "paid in full",
  );
});

Deno.test("counter POS release allows paid cash-class tickets", () => {
  assertCounterReleaseAllowed({
    order_source: "counter",
    status: "submitted",
    payment_classification: "cash",
    payment_status: "paid",
    charge_authorization_status: "not_applicable",
  });
});

Deno.test("counter POS release allows approved charge-class tickets", () => {
  assertCounterReleaseAllowed({
    order_source: "phone",
    status: "confirmed",
    payment_classification: "charge",
    payment_status: "charge_account",
    charge_authorization_status: "approved_credit",
  });
});

Deno.test("counter POS release blocks pending charge-class tickets", () => {
  assertThrows(
    () =>
      assertCounterReleaseAllowed({
        order_source: "counter",
        status: "processing",
        payment_classification: "charge",
        payment_status: "charge_account",
        charge_authorization_status: "pending_ar_approval",
      }),
    CounterPosRuleError,
    "approved credit",
  );
});

Deno.test("counter POS normalize blocks counter-side cash to charge conversion", () => {
  assertThrows(
    () =>
      normalizeCounterTenderInput(
        {
          payment_classification: "charge",
          charge_authorization_status: "approved_credit",
        },
        { payment_classification: "cash", payment_status: "unpaid" },
      ),
    CounterPosRuleError,
    "Cash-to-charge conversion",
  );
});

Deno.test("counter POS normalize allows initial charge ticket creation", () => {
  assertEquals(
    normalizeCounterTenderInput({
      payment_classification: "charge",
      charge_authorization_status: "approved_credit",
    }),
    {
      payment_classification: "charge",
      payment_status: "charge_account",
      payment_reference: null,
      charge_authorization_status: "approved_credit",
      charge_authorization_note: null,
    },
  );
});

Deno.test("counter POS normalize carries tender metadata", () => {
  assertEquals(
    normalizeCounterTenderInput({
      payment_classification: "charge",
      charge_authorization_status: "pending_ar_approval",
      charge_authorization_note: "Needs AR approval",
      payment_reference: "PO-7788",
    }, { payment_classification: "charge" }),
    {
      payment_classification: "charge",
      payment_status: "charge_account",
      payment_reference: "PO-7788",
      charge_authorization_status: "pending_ar_approval",
      charge_authorization_note: "Needs AR approval",
    },
  );
});
