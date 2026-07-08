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
      tender_type: null,
      tender_amount: null,
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
      tender_type: null,
      tender_amount: null,
    },
  );
});

Deno.test("tender capture: cash paid defaults tender_type to cash and rounds amount", () => {
  const patch = normalizeCounterTenderInput(
    { payment_classification: "cash", payment_status: "paid", tender_amount: "150.005" },
    null,
  );
  assertEquals(patch.tender_type, "cash");
  assertEquals(patch.tender_amount, 150.01);
});

Deno.test("tender capture: explicit check tender is preserved", () => {
  const patch = normalizeCounterTenderInput(
    { payment_classification: "cash", payment_status: "paid", tender_type: "check", tender_amount: 89.5 },
    null,
  );
  assertEquals(patch.tender_type, "check");
  assertEquals(patch.tender_amount, 89.5);
});

Deno.test("tender capture: invalid tender_type throws", () => {
  assertThrows(
    () =>
      normalizeCounterTenderInput(
        { payment_classification: "cash", payment_status: "paid", tender_type: "iou" },
        null,
      ),
    CounterPosRuleError,
    "tender_type",
  );
});

Deno.test("tender capture: negative tender_amount throws", () => {
  assertThrows(
    () =>
      normalizeCounterTenderInput(
        { payment_classification: "cash", payment_status: "paid", tender_amount: -5 },
        null,
      ),
    CounterPosRuleError,
    "tender_amount",
  );
});

Deno.test("tender capture: charge tickets carry no tender", () => {
  const patch = normalizeCounterTenderInput(
    { payment_classification: "charge", tender_type: "card", tender_amount: 100 },
    null,
  );
  assertEquals(patch.tender_type, null);
  assertEquals(patch.tender_amount, null);
});

Deno.test("tender capture: update inherits current tender when not provided", () => {
  const patch = normalizeCounterTenderInput(
    { payment_status: "paid" },
    {
      payment_classification: "cash",
      payment_status: "unpaid",
      tender_type: "card",
      tender_amount: "42.42",
    },
  );
  assertEquals(patch.tender_type, "card");
  assertEquals(patch.tender_amount, 42.42);
});

Deno.test("tender capture: unpaid cash ticket has null tender_type by default", () => {
  const patch = normalizeCounterTenderInput(
    { payment_classification: "cash", payment_status: "unpaid" },
    null,
  );
  assertEquals(patch.tender_type, null);
  assertEquals(patch.tender_amount, null);
});
