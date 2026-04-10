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
    });
  });

  test("returns an empty summary for missing quote data", () => {
    expect(summarizePortalQuoteReview(null)).toEqual({
      headline: null,
      notes: [],
      terms: [],
      lineItems: [],
    });
  });
});
