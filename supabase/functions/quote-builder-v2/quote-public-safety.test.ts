import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  assertPublicQuoteAcceptReady,
  assertPublicQuoteReadReady,
  assertQuoteCustomerContentReady,
  buildCustomerProposalEmailText,
  buildPublicDealRoomPayload,
  validatePublicSignatureDataUrl,
} from "./quote-public-safety.ts";

Deno.test("public deal-room payload sanitizes line items and AI recommendation internals", () => {
  const payload = buildPublicDealRoomPayload({
    id: "quote-1",
    quote_number: "QEP-2026-0001",
    status: "sent",
    customer_total: "125000.50",
    why_this_machine: "Confirmed narrative",
    why_this_machine_confirmed: true,
    special_terms: "Subject to final lender approval.",
    delivery_eta: "2 weeks",
    deposit_required_amount: "5000",
    tax_profile: "standard",
    tax_override_reason: "County surtax adjustment",
    follow_up_at: "2026-06-01T00:00:00Z",
    equipment: [{
      make: "Case",
      model: "580",
      price: 120000,
      dealer_cost: 90000,
      metadata: { margin: 30 },
    }],
    attachments_included: [{
      name: "Bucket",
      price: 2500,
      quoted_dealer_cost: 1100,
    }],
    quote_package_line_items: [{
      id: "line-1",
      catalog_entry_id: "catalog-1",
      line_type: "equipment",
      description: "Case 580",
      make: "Case",
      model: "580",
      year: 2026,
      quantity: 1,
      unit_price: "120000",
      extended_price: 120000,
      display_order: 0,
      quoted_dealer_cost: 90000,
      metadata: { source: "internal" },
      approval_required: true,
    }, {
      line_type: "discount",
      description: "Loyalty discount",
      unit_price: -1000,
      extended_price: -1000,
      reason_code: "loyalty",
      metadata: { approval: true },
    }],
    ai_recommendation: {
      machine: "Case 580",
      reasoning: "Good fit for the job.",
      attachments: ["Bucket"],
      alternative: {
        machine: "Case 590",
        reasoning: "More capacity.",
        attachments: ["Forks"],
        whyNotChosen: "Higher price.",
        trigger: { prompt: "internal" },
      },
      jobFacts: [{ label: "Use", value: "Utility" }],
      transcriptHighlights: [{
        quote: "Need a backhoe",
        supports: "Machine class",
      }],
      trigger: { source: "ai_chat" },
      sourceField: "voice_transcript",
      excerpt: "internal transcript excerpt",
    },
    margin_pct: 28,
  });

  assertEquals(payload.quote_number, "QEP-2026-0001");
  assertEquals(payload.why_this_machine, "Confirmed narrative");
  assertEquals(payload.why_this_machine_confirmed, true);
  assertEquals(payload.deposit_required_amount, 5000);

  const line =
    (payload.quote_package_line_items as Array<Record<string, unknown>>)[0];
  assertEquals(line.description, "Case 580");
  assertEquals(line.unit_price, 120000);
  assertEquals(line.quoted_dealer_cost, undefined);
  assertEquals(line.catalog_entry_id, undefined);
  assertEquals(line.metadata, undefined);
  assertEquals(line.approval_required, undefined);

  const discount =
    (payload.quote_package_line_items as Array<Record<string, unknown>>)[1];
  assertEquals(discount.reason_code, "loyalty");

  const equipment = (payload.equipment as Array<Record<string, unknown>>)[0];
  assertEquals(equipment.dealer_cost, undefined);
  assertEquals(equipment.metadata, undefined);

  const recommendation = payload.ai_recommendation as Record<string, unknown>;
  assertEquals(recommendation.reasoning, "Good fit for the job.");
  assertEquals(
    (recommendation.transcriptHighlights as Array<Record<string, unknown>>)[0]
      .quote,
    "",
  );
  assertEquals(JSON.stringify(payload).includes("Need a backhoe"), false);
  assertEquals(recommendation.trigger, undefined);
  assertEquals(recommendation.sourceField, undefined);
  assertEquals(recommendation.excerpt, undefined);
  assertEquals(
    (recommendation.alternative as Record<string, unknown>).trigger,
    undefined,
  );
});

Deno.test("customer content readiness blocks unconfirmed narrative and tax gaps", () => {
  const unconfirmed = assertQuoteCustomerContentReady({
    why_this_machine: "Use this machine.",
    why_this_machine_confirmed: false,
    tax_profile: "standard",
    tax_total: 100,
  });
  assertEquals(unconfirmed.ok, false);
  if (!unconfirmed.ok) {
    assertEquals(unconfirmed.blockers[0].code, "why_this_machine_unconfirmed");
  }

  const confirmedWithoutNarrative = assertQuoteCustomerContentReady({
    why_this_machine_confirmed: true,
    tax_profile: "standard",
    tax_total: 100,
  });
  assertEquals(confirmedWithoutNarrative.ok, false);
  if (!confirmedWithoutNarrative.ok) {
    assertEquals(confirmedWithoutNarrative.blockers[0].code, "why_this_machine_missing");
  }

  const missingTax = assertQuoteCustomerContentReady({
    why_this_machine_confirmed: false,
    tax_profile: "standard",
    tax_total: null,
  });
  assertEquals(missingTax.ok, false);
  if (!missingTax.ok) {
    assertEquals(missingTax.blockers[0].code, "tax_total_missing");
  }

  const missingOverrideReason = assertQuoteCustomerContentReady({
    why_this_machine: "Confirmed narrative.",
    why_this_machine_confirmed: true,
    tax_profile: "standard",
    tax_total: 100,
    tax_override_amount: 250,
  });
  assertEquals(missingOverrideReason.ok, false);
  if (!missingOverrideReason.ok) {
    assertEquals(
      missingOverrideReason.blockers[0].code,
      "tax_override_reason_missing",
    );
  }

  assertEquals(
    assertQuoteCustomerContentReady({
      why_this_machine_confirmed: false,
      tax_profile: "agriculture_exempt",
      tax_total: null,
    }),
    { ok: true },
  );
});

Deno.test("public recommendation context is withheld without a confirmed narrative", () => {
  const payload = buildPublicDealRoomPayload({
    quote_number: "QEP-2026-0002",
    why_this_machine_confirmed: true,
    tax_profile: "standard",
    tax_total: 10,
    ai_recommendation: { machine: "Case 580", reasoning: "AI-only draft" },
  });

  assertEquals(payload.ai_recommendation, null);
});

Deno.test("public quote access rejects expired links", () => {
  const expired = assertPublicQuoteReadReady({
    status: "sent",
    expires_at: "2026-05-11T00:00:00Z",
    why_this_machine: "Confirmed narrative.",
    why_this_machine_confirmed: true,
    tax_profile: "standard",
    tax_total: 100,
  }, Date.parse("2026-05-12T00:00:00Z"));

  assertEquals(expired, {
    ok: false,
    message: "This quote link has expired.",
    status: 410,
  });
});

Deno.test("public accept rejects stale statuses and expired quotes", () => {
  assertEquals(
    assertPublicQuoteAcceptReady({
      status: "accepted",
      expires_at: "2026-05-13T00:00:00Z",
      why_this_machine: "Confirmed narrative.",
      why_this_machine_confirmed: true,
      tax_profile: "standard",
      tax_total: 100,
    }, Date.parse("2026-05-12T00:00:00Z")),
    {
      ok: false,
      message: "This quote has already been accepted.",
      status: 409,
    },
  );

  assertEquals(
    assertPublicQuoteAcceptReady({
      status: "sent",
      expires_at: "2026-05-11T00:00:00Z",
      why_this_machine: "Confirmed narrative.",
      why_this_machine_confirmed: true,
      tax_profile: "standard",
      tax_total: 100,
    }, Date.parse("2026-05-12T00:00:00Z")),
    {
      ok: false,
      message: "This quote has expired and cannot be signed.",
      status: 409,
    },
  );
});

Deno.test("public signature validation only accepts bounded PNG data URLs", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
  assertEquals(validatePublicSignatureDataUrl(png), { ok: true, value: png });
  assertEquals(validatePublicSignatureDataUrl("data:image/svg+xml;base64,PHN2Zy8+"), {
    ok: false,
    message: "Signature must be a PNG image.",
    status: 400,
  });
  assertEquals(validatePublicSignatureDataUrl("data:image/png;base64,AAAA"), {
    ok: false,
    message: "Signature must be a PNG image.",
    status: 400,
  });
});

Deno.test("customer proposal email is a safe notification, not a raw proposal dump", () => {
  const body = buildCustomerProposalEmailText({
    contactName: "Taylor Buyer",
    quoteNumber: "QEP-2026-0001",
    customerTotal: 125000,
    amountFinanced: 100000,
    selectedFinanceScenario: "60 month finance",
    whyThisMachine: "This configuration matches your utility workload.",
    whyThisMachineConfirmed: true,
    specialTerms: "Subject to final lender approval.",
    expiresAt: "2026-06-01T00:00:00Z",
    publicUrl: "https://qep.example/q/token",
    branch: {
      name: "QEP Orlando",
      phone: "555-0100",
      email: "sales@example.com",
      website: "https://qep.example",
    },
  });

  assert(
    body.includes(
      "Your Quality Equipment & Parts proposal is ready for review.",
    ),
  );
  assert(body.includes("Quote: QEP-2026-0001"));
  assert(body.includes("Customer total: $125,000"));
  assert(body.includes("Why this machine:"));
  assert(body.includes("Review your proposal: https://qep.example/q/token"));
  assert(!body.includes("dealer cost"));
  assert(!body.includes("margin"));
  assert(!body.includes("approval_required"));

  const cashBody = buildCustomerProposalEmailText({
    contactName: "Cash Buyer",
    customerTotal: 50_000,
    amountFinanced: 0,
    selectedFinanceScenario: "Cash",
  });
  assert(!cashBody.includes("Estimated amount financed: $0"));
});
