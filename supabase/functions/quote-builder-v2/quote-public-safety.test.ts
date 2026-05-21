import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  assertPublicQuoteAcceptReady,
  assertPublicQuoteReadReady,
  assertQuoteCustomerContentReady,
  buildCustomerProposalEmailText,
  buildCustomerProposalSmsText,
  buildDeliveryTermsLine,
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
    deposit_status: "verified",
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
    selected_finance_scenario: "60 months",
    financing_scenarios: [{
      type: "cash",
      label: "Cash",
      total_cost: 125000,
    }, {
      type: "finance",
      label: "60 months",
      apr: 7.25,
      monthly_payment: 2050,
      show_finance_comparison_on_customer_copy: false,
      apr_source: {
        kind: "manufacturer_program",
        label: "Yanmar Spring APR",
        provider: "Yanmar",
        effectiveFrom: "2026-04-01",
        internal_rate_sheet_id: "secret-rate-sheet",
      },
    }, {
      type: "lease",
      kind: "lease_fmv",
      label: "FMV lease",
      apr: 6.9,
      monthly_payment: 1850,
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
  assertEquals(payload.deposit_status, "verified");

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

  const financeScenarios = payload.financing_scenarios as Array<Record<string, unknown>>;
  assertEquals(financeScenarios.map((scenario) => scenario.label), ["60 months"]);
  assertEquals(JSON.stringify(payload).includes("Cash"), false);
  assertEquals(JSON.stringify(payload).includes("FMV lease"), false);
  assertEquals(payload.selected_finance_scenario, "60 months");
  const finance = financeScenarios[0];
  assertEquals(finance.apr_source, {
    kind: "manufacturer_program",
    label: "Yanmar Spring APR",
    provider: "Yanmar",
    programId: null,
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    disclosure: null,
  });
  assertEquals(JSON.stringify(finance).includes("secret-rate-sheet"), false);

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

Deno.test("public deal-room payload honors quote-level comparison toggle from metadata", () => {
  const payload = buildPublicDealRoomPayload({
    status: "sent",
    metadata: { show_finance_comparison_on_customer_copy: false },
    selected_finance_scenario: "60 months",
    financing_scenarios: [{
      type: "cash",
      label: "Cash",
      total_cost: 100000,
    }, {
      type: "finance",
      label: "60 months",
      apr: 7.25,
      monthly_payment: 2050,
      lender: "Preferred lender",
    }, {
      type: "lease",
      kind: "lease_fmv",
      label: "FMV lease",
      monthly_payment: 1850,
    }],
  });

  const financeScenarios = payload.financing_scenarios as Array<Record<string, unknown>>;
  assertEquals(financeScenarios.map((scenario) => scenario.label), ["60 months"]);
  assertEquals(JSON.stringify(payload).includes("FMV lease"), false);
  assertEquals(JSON.stringify(payload).includes("Cash"), false);
  assertEquals(financeScenarios[0].apr_source, null);
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
      "Thank you for working with Quality Equipment & Parts. Your equipment proposal is ready for review.",
    ),
  );
  assert(body.includes("Quote: QEP-2026-0001"));
  assert(body.includes("Customer total: $125,000"));
  assert(body.includes("Payment option reviewed: 60 month finance"));
  assert(body.includes("Why this setup fits your work:"));
  assert(body.includes("Review the proposal and next steps: https://qep.example/q/token"));
  assert(body.includes("Delivery timing and destination are listed in your proposal terms."));
  assert(!body.includes("{{"));
  assert(!body.includes("}}"));
  assert(body.includes("Payment figures are estimates until lender approval, taxes, title, registration, documentation, and signed agreements are complete."));
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

Deno.test("customer proposal email includes exact Q9 delivery wording when delivery data is present", () => {
  const body = buildCustomerProposalEmailText({
    contactName: "Taylor Buyer",
    quoteNumber: "QEP-2026-0001",
    customerTotal: 125000,
    shippingAddress: "440 Yard Rd, Orlando, FL",
    deliveryWindow: "June 5-7",
  });

  assert(body.includes("Delivered to 440 Yard Rd, Orlando, FL per quote terms. Delivery window: June 5-7. Weather and access permitting."));
  assert(!body.includes("{{"));
  assert(!body.includes("}}"));
});

Deno.test("delivery and sms templates keep QEP outbound wording deterministic", () => {
  assertEquals(
    buildDeliveryTermsLine("440 Yard Rd, Orlando, FL", "June 5-7"),
    "Delivered to 440 Yard Rd, Orlando, FL per quote terms. Delivery window: June 5-7. Weather and access permitting.",
  );
  assertEquals(
    buildDeliveryTermsLine(null, null),
    "Delivered to {{shipping_address}} per quote terms. Delivery window: {{delivery_window}}. Weather and access permitting.",
  );

  assertEquals(
    buildCustomerProposalSmsText("https://qep.example/q/token"),
    "Quality Equipment & Parts: Your proposal is ready to review at https://qep.example/q/token. Reply to this text or call your QEP rep with questions.",
  );
  assertEquals(
    buildCustomerProposalSmsText(null),
    "Quality Equipment & Parts: Your proposal is ready to review at {{proposal_link}}. Reply to this text or call your QEP rep with questions.",
  );
});
