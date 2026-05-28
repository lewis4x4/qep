import { describe, expect, test } from "bun:test";
import {
  normalizeCreateRepriceDraftResponse,
  normalizeRepPriceImpactsResponse,
  normalizeRepPriceImpactLine,
} from "./price-intelligence-api";

describe("OEM price impact API normalizers", () => {
  test("normalizes rep impacts from the oem-price-feeds snake_case contract", () => {
    const result = normalizeRepPriceImpactsResponse({
      summary: {
        visibleImpactCount: 2,
        affectedQuoteCount: 2,
        totalDeltaCents: 845000,
        needsApprovalCount: 1,
      },
      impacts: [
        {
          id: "impact-1",
          event_id: "event-1",
          quote_package_id: "quote-1",
          deal_id: "deal-1",
          assigned_rep_id: "rep-1",
          quote_status_snapshot: "sent",
          quote_updated_at_snapshot: "2026-05-20T18:00:00Z",
          total_delta_cents: 525000,
          max_line_delta_pct: "3.2",
          old_margin_pct: 18,
          projected_margin_pct: 16.5,
          margin_floor_pct: 17,
          below_margin_floor: true,
          materiality_trigger: "both",
          requires_manager_review: true,
          approval_required_reasons: ["manager_review_policy", "below_margin_floor"],
          old_commission_cents: 120000,
          projected_commission_cents: 105000,
          commission_delta_cents: -15000,
          state: "visible",
          created_at: "2026-05-20T18:01:00Z",
          qb_quote_reprice_impact_lines: [
            {
              id: "line-1",
              model_code: "TL25",
              make: "Yanmar",
              quantity: 1,
              old_list_price_cents: 1000000,
              new_list_price_cents: 1052500,
              delta_cents: 52500,
              delta_pct: 5.25,
              source_location: "factory",
              is_yard_stock: false,
              suppressed_by_stock_lock: false,
            },
          ],
        },
      ],
    });

    expect(result.summary).toEqual({
      visibleImpactCount: 2,
      affectedQuoteCount: 2,
      totalDeltaCents: 845000,
      needsApprovalCount: 1,
    });
    expect(result.impacts[0]).toMatchObject({
      id: "impact-1",
      eventId: "event-1",
      quotePackageId: "quote-1",
      materialityTrigger: "both",
      requiresManagerReview: true,
      approvalRequiredReasons: ["manager_review_policy", "below_margin_floor"],
      state: "visible",
    });
    expect(result.impacts[0].lines[0]).toMatchObject({
      modelCode: "TL25",
      make: "Yanmar",
      deltaCents: 52500,
      suppressedByStockLock: false,
    });
  });

  test("accepts snake_case summary fields for API compatibility", () => {
    const result = normalizeRepPriceImpactsResponse({
      summary: {
        visible_impact_count: 3,
        affected_quote_count: 2,
        total_delta_cents: 125000,
        needs_approval_count: 1,
      },
      impacts: [],
    });

    expect(result.summary).toEqual({
      visibleImpactCount: 3,
      affectedQuoteCount: 2,
      totalDeltaCents: 125000,
      needsApprovalCount: 1,
    });
  });

  test("normalizes reprice draft responses from camelCase or snake_case", () => {
    expect(normalizeCreateRepriceDraftResponse({
      ok: true,
      draft_id: "draft-1",
      status: "approval_pending",
      approval_required: true,
      approval_reasons: ["manager_review_policy"],
      email_draft_id: "email-1",
    })).toEqual({
      ok: true,
      draftId: "draft-1",
      status: "approval_pending",
      approvalRequired: true,
      approvalReasons: ["manager_review_policy"],
      emailDraftId: "email-1",
    });

    expect(normalizeCreateRepriceDraftResponse({
      ok: true,
      draftId: "draft-2",
      status: "draft",
      approvalRequired: false,
    })).toMatchObject({
      draftId: "draft-2",
      status: "draft",
      approvalRequired: false,
      approvalReasons: [],
      emailDraftId: null,
    });
  });

  test("preserves non-actionable states instead of making them visible", () => {
    const result = normalizeRepPriceImpactsResponse({
      summary: {},
      impacts: [{
        id: "impact-dismissed",
        quote_package_id: "quote-1",
        state: "dismissed",
      }],
    });

    expect(result.impacts[0].state).toBe("dismissed");
  });

  test("keeps yard-stock suppression details visible to the rep", () => {
    expect(normalizeRepPriceImpactLine({
      id: "line-yard",
      model_code: "VIO80",
      quantity: 1,
      delta_cents: 0,
      source_location: "yard_stock",
      is_yard_stock: true,
      suppressed_by_stock_lock: true,
      suppression_reason: "yard_stock_price_locked",
    })).toMatchObject({
      id: "line-yard",
      modelCode: "VIO80",
      isYardStock: true,
      suppressedByStockLock: true,
      suppressionReason: "yard_stock_price_locked",
    });
  });
});
