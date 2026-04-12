import { describe, expect, test } from "bun:test";
import { buildPortalQuoteActionRail, buildPortalQuoteChecklist, buildPortalQuoteTimeline } from "./portal-quote-room";
import type { PortalQuoteSummary } from "./portal-api";
import type { PortalQuoteReviewSummary } from "./portal-quote-review";

const quote: PortalQuoteSummary = {
  id: "quote-1",
  deal_id: "deal-1",
  deal_name: "Apex Timber",
  amount: 105000,
  status: "viewed",
  viewed_at: "2026-04-12T13:00:00.000Z",
  signed_at: null,
  signer_name: null,
  expires_at: "2026-04-20T00:00:00.000Z",
  quote_pdf_url: null,
  quote_data: null,
  portal_status: {
    label: "Quote reviewed",
    source: "quote_review",
    source_label: "Your quote response",
    eta: "2026-04-20T00:00:00.000Z",
    last_updated_at: "2026-04-12T13:00:00.000Z",
    next_action: "Review the quote details and sign when you're ready.",
  },
};

const summary: PortalQuoteReviewSummary = {
  headline: "Premium compact track loader package.",
  notes: [],
  terms: ["Net 15"],
  lineItems: [{ description: "CTL", quantity: 1, amount: 105000 }],
  equipmentLabels: ["Kubota SVL75 2025"],
  financingHighlights: ["FINANCE · $2,495/mo · 60 mo"],
  subtotal: 120000,
  tradeAllowance: 15000,
  netTotal: 105000,
};

describe("portal quote room helpers", () => {
  test("builds a readable proposal timeline", () => {
    const timeline = buildPortalQuoteTimeline(quote);
    expect(timeline.map((item) => item.label)).toEqual([
      "Proposal prepared",
      "Proposal opened for review",
      "Decision captured",
      "Proposal expiry window",
    ]);
    expect(timeline[1]?.state).toBe("done");
  });

  test("builds dealership action rail entries", () => {
    const actions = buildPortalQuoteActionRail(quote, summary);
    expect(actions.map((item) => item.title)).toEqual([
      "Dealership action",
      "Financing path included",
      "Time-sensitive review",
    ]);
  });

  test("builds customer checklist state", () => {
    const checklist = buildPortalQuoteChecklist(quote, summary);
    expect(checklist).toEqual([
      { label: "Review the equipment scope", done: true },
      { label: "Confirm pricing and net total", done: true },
      { label: "Check financing options if needed", done: true },
      { label: "Read the proposal terms", done: true },
      { label: "Accept, decline, or request changes", done: false },
      { label: "Wait for dealership revision after requested changes", done: true },
      { label: "Review the revised proposal after dealership response", done: true },
    ]);
  });
});
