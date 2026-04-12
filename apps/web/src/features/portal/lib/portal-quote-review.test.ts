import { describe, expect, test } from "bun:test";
import { summarizePortalQuoteReview } from "./portal-quote-review";

describe("portal quote review helpers", () => {
  test("extracts summary, notes, terms, and line items from quote data", () => {
    expect(
      summarizePortalQuoteReview({
        summary: "Replace the worn hydraulic coupler and complete annual inspection.",
        notes: ["Machine can stay on site."],
        terms: ["Net 15", "Subject to parts availability"],
        line_items: [
          { description: "Hydraulic coupler", quantity: 1, amount: 420.5 },
          { name: "Inspection labor", quantity: 2, total: 180 },
        ],
      }),
    ).toEqual({
      headline: "Replace the worn hydraulic coupler and complete annual inspection.",
      notes: ["Machine can stay on site."],
      terms: ["Net 15", "Subject to parts availability"],
      lineItems: [
        { description: "Hydraulic coupler", quantity: 1, amount: 420.5 },
        { description: "Inspection labor", quantity: 2, amount: 180 },
      ],
      equipmentLabels: [],
      financingHighlights: [],
      subtotal: null,
      tradeAllowance: null,
      netTotal: null,
      dealerMessage: null,
      revisionSummary: null,
    });
  });

  test("extracts commercial summary details from quote payloads", () => {
    expect(
      summarizePortalQuoteReview({
        equipment: [{ make: "Kubota", model: "SVL75", year: 2025 }],
        financing: [{ type: "finance", monthlyPayment: 2495, termMonths: 60 }],
        subtotal: 120000,
        trade_allowance: 15000,
        net_total: 105000,
        dealer_message: "We revised the proposal to match your requested monthly payment target.",
        revision_summary: "Updated financing structure and removed one attachment.",
      }),
    ).toEqual({
      headline: null,
      notes: [],
      terms: [],
      lineItems: [],
      equipmentLabels: ["Kubota SVL75 2025"],
      financingHighlights: ["FINANCE · $2,495/mo · 60 mo"],
      subtotal: 120000,
      tradeAllowance: 15000,
      netTotal: 105000,
      dealerMessage: "We revised the proposal to match your requested monthly payment target.",
      revisionSummary: "Updated financing structure and removed one attachment.",
    });
  });

  test("returns an empty summary for missing quote data", () => {
    expect(summarizePortalQuoteReview(null)).toEqual({
      headline: null,
      notes: [],
      terms: [],
      lineItems: [],
      equipmentLabels: [],
      financingHighlights: [],
      subtotal: null,
      tradeAllowance: null,
      netTotal: null,
      dealerMessage: null,
      revisionSummary: null,
    });
  });
});
