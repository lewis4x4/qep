import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canTransitionH8WarrantyClaim,
  h8NoRebillFieldsForFault,
  h8PayerBillingFields,
  normalizeH8ComebackFaultAttribution,
  normalizeH8PayerType,
  normalizeH8WarrantyClaimStatus,
} from "./service-h8-comeback-warranty.ts";

Deno.test("H8 payer normalization maps warranty and internal aliases", () => {
  assertEquals(normalizeH8PayerType("Warranty"), "warranty_claim");
  assertEquals(normalizeH8PayerType("oem warranty"), "warranty_claim");
  assertEquals(normalizeH8PayerType("QEP fault"), "qep_internal");
  assertEquals(normalizeH8PayerType("customer"), "customer");
  assertEquals(normalizeH8PayerType("not-a-payer"), null);
});

Deno.test("H8 comeback fault normalization maps owner-facing labels", () => {
  assertEquals(normalizeH8ComebackFaultAttribution("our fault"), "qep_fault");
  assertEquals(
    normalizeH8ComebackFaultAttribution("operator error"),
    "customer_fault",
  );
  assertEquals(
    normalizeH8ComebackFaultAttribution("manufacturer"),
    "oem_fault",
  );
  assertEquals(normalizeH8ComebackFaultAttribution("sublet"), "vendor_fault");
  assertEquals(
    normalizeH8ComebackFaultAttribution("defective part"),
    "parts_defect",
  );
});

Deno.test("H8 QEP-fault comeback produces no-rebill internal billing fields", () => {
  assertEquals(h8NoRebillFieldsForFault("qep_fault"), {
    comeback_no_rebill: true,
    revenue_type: "internal",
    billing_basis: "no_charge",
    billed_status: "billing_hold",
  });
  assertEquals(h8NoRebillFieldsForFault("customer_fault"), {
    comeback_no_rebill: false,
  });
});

Deno.test("H8 payer billing fields route mixed jobs", () => {
  assertEquals(h8PayerBillingFields("warranty_claim"), {
    revenue_type: "warranty",
    billing_basis: "warranty",
    billed_status: "unbilled",
  });
  assertEquals(h8PayerBillingFields("qep_internal"), {
    revenue_type: "internal",
    billing_basis: "no_charge",
    billed_status: "billing_hold",
  });
});

Deno.test("H8 warranty claim status transitions follow OEM lifecycle", () => {
  assertEquals(
    normalizeH8WarrantyClaimStatus("OEM Evaluation"),
    "oem_evaluation",
  );
  assertEquals(canTransitionH8WarrantyClaim("draft", "submitted"), true);
  assertEquals(
    canTransitionH8WarrantyClaim("submitted", "oem_evaluation"),
    true,
  );
  assertEquals(
    canTransitionH8WarrantyClaim("oem_evaluation", "approved"),
    true,
  );
  assertEquals(canTransitionH8WarrantyClaim("approved", "paid"), true);
  assertEquals(canTransitionH8WarrantyClaim("paid", "denied"), false);
  assertEquals(canTransitionH8WarrantyClaim("denied", "submitted"), false);
});
