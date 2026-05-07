import { describe, expect, test } from "bun:test";

import type { DealRoomBranch, DealRoomQuote } from "../deal-room-api";
import {
  getAdditionalProposalLineItems,
  getCommercialDetails,
  getConfirmedWhyThisMachine,
  getDealRoomRecommendationContext,
  getPrimaryProposalLine,
  getProposalComplianceNotes,
  getTaxDetail,
} from "../deal-room-proposal";

function makeQuote(overrides: Partial<DealRoomQuote> = {}): DealRoomQuote {
  return {
    id: "q1",
    quote_number: "QEP-2026-0001",
    status: "sent",
    customer_name: "Sam Customer",
    customer_company: null,
    branch_slug: "main",
    equipment: [{ make: "Case", model: "TV450B", year: 2024, price: 82_000, title: null }],
    attachments_included: [{ name: "Bucket", price: 3_500 }],
    quote_package_line_items: [],
    subtotal: 85_500,
    equipment_total: 82_000,
    attachment_total: 3_500,
    discount_total: 2_000,
    trade_credit: 0,
    net_total: 83_500,
    tax_total: 5_010,
    cash_down: 10_000,
    amount_financed: 78_510,
    customer_total: 88_510,
    financing_scenarios: [{ label: "QEP Finance 60", type: "finance", term_months: 60, apr: 7.5, rate: null, monthly_payment: 1573, total_cost: 94_380, lender: "QEP Finance" }],
    selected_finance_scenario: "QEP Finance 60",
    ai_recommendation: {
      reasoning: "RAW AI SHOULD NOT DISPLAY AS NARRATIVE",
      jobFacts: [{ label: "Acreage", value: "120 acres" }],
      transcriptHighlights: [{ quote: "We need high flow", supports: "Hydraulic requirement" }],
      jobConsiderations: ["High-flow attachments are planned"],
      alternative: { machine: "Case TV370B", attachments: ["Bucket"], reasoning: "Smaller frame", whyNotChosen: "Less hydraulic headroom" },
    },
    why_this_machine: "Rep-confirmed TV450B story for this customer.",
    why_this_machine_confirmed: true,
    special_terms: "Subject to final inspection and lender approval.",
    delivery_eta: "7-10 business days after deposit",
    deposit_required_amount: 5_000,
    tax_profile: "standard",
    tax_override_reason: null,
    follow_up_at: "2026-05-15T12:00:00.000Z",
    created_at: "2026-05-07T12:00:00.000Z",
    updated_at: null,
    expires_at: "2026-06-06T12:00:00.000Z",
    sent_at: null,
    viewed_at: null,
    ...overrides,
  };
}

describe("deal-room proposal shaping", () => {
  test("uses only confirmed why-this-machine text and gates recommendation context", () => {
    const confirmed = makeQuote();
    expect(getConfirmedWhyThisMachine(confirmed)).toBe("Rep-confirmed TV450B story for this customer.");
    expect(getDealRoomRecommendationContext(confirmed)?.reasoning).toBe("RAW AI SHOULD NOT DISPLAY AS NARRATIVE");
    expect(getDealRoomRecommendationContext(confirmed)?.transcriptHighlights?.[0]?.quote).toBe("");

    const unconfirmed = makeQuote({ why_this_machine_confirmed: false });
    expect(getConfirmedWhyThisMachine(unconfirmed)).toBeNull();
    expect(getDealRoomRecommendationContext(unconfirmed)).toBeNull();
  });

  test("prefers sanitized public line items and excludes the primary equipment from additional rows", () => {
    const quote = makeQuote({
      equipment: [{ make: "Legacy", model: "Loader", year: 2020, price: 1, title: null }],
      attachments_included: [{ name: "Legacy attachment", price: 2 }],
      quote_package_line_items: [
        { line_type: "equipment", description: "Case TV450B compact track loader", make: "Case", model: "TV450B", year: 2024, quantity: 1, unit_price: 82_000, extended_price: 82_000, display_order: 1 },
        { line_type: "attachment", description: "84 in bucket", make: null, model: null, year: null, quantity: 1, unit_price: 3_500, extended_price: 3_500, display_order: 2 },
        { line_type: "discount", description: "Commercial discount", make: null, model: null, year: null, quantity: 1, unit_price: -2_000, extended_price: -2_000, display_order: 3, reason_code: "volume_buyer" },
      ],
    });

    expect(getPrimaryProposalLine(quote)?.label).toBe("Case TV450B compact track loader");
    const additional = getAdditionalProposalLineItems(quote);
    expect(additional.map((line) => line.label)).toEqual(["84 in bucket", "Commercial discount"]);
    expect(additional[1].tone).toBe("credit");
    expect(additional[1].displayAmount).toBe(2_000);
  });

  test("surfaces tax, terms, deposit, expiration, follow-up, and compliance details", () => {
    const branch: DealRoomBranch = { name: "QEP", doc_footer_text: "Branch fallback footer" };
    const quote = makeQuote({
      tax_profile: "agriculture_exempt",
      tax_override_reason: "Farm exemption certificate on file",
    });

    expect(getTaxDetail(quote)).toBe("Tax override applied; reason recorded: Farm exemption certificate on file");
    const details = getCommercialDetails(quote, branch);
    expect(details.map((detail) => detail.label)).toEqual([
      "Proposal valid until",
      "Deposit required",
      "Delivery ETA",
      "Rep follow-up",
      "Tax treatment",
      "Special terms",
    ]);
    expect(details.find((detail) => detail.label === "Deposit required")?.value).toBe("$5,000.00");
    expect(getProposalComplianceNotes(quote)[0]).toContain("Financing and payment figures are estimates");
  });
});
