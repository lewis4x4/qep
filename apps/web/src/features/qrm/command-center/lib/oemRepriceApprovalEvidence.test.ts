import { describe, expect, test } from "bun:test";
import {
  extractOemRepriceApprovalEvidence,
  isOemRepriceDecisionNoteRequired,
} from "./oemRepriceApprovalEvidence";

describe("OEM reprice approval evidence", () => {
  test("normalizes manager economics, affected lines, and no-send semantics", () => {
    const evidence = extractOemRepriceApprovalEvidence(
      {
        approval_kind: "oem_reprice",
        oem_reprice: {
          economics: {
            current_net_total_cents: "8200000",
            projected_net_total_cents: 8350000,
          },
        },
      },
      {
        approval_kind: "oem_reprice",
        change_categories: ["list_price", 42, "freight"],
        approval_required_reasons: ["below_margin_floor"],
        total_delta_cents: 150000,
        old_margin_pct: 8.2,
        projected_margin_pct: "7.1",
        margin_floor_pct: 8,
        below_margin_floor: true,
        old_commission_cents: 42000,
        projected_commission_cents: 37000,
        commission_delta_cents: -5000,
        lines: [{
          impactLineId: "impact-line-1",
          quotePackageLineItemId: "quote-line-1",
          modelCode: "333G",
          oldPriceCents: 8000000,
          newPriceCents: 8150000,
          quantity: 1,
          suppressedByStockLock: false,
        }],
        customer_communication: "unexpected-value",
      },
    );

    expect(evidence).toMatchObject({
      approvalKind: "oem_reprice",
      changeCategories: ["list_price", "freight"],
      reasons: ["below_margin_floor"],
      currentNetTotalCents: 8200000,
      projectedNetTotalCents: 8350000,
      totalDeltaCents: 150000,
      oldMarginPct: 8.2,
      projectedMarginPct: 7.1,
      belowMarginFloor: true,
      customerCommunication: "none",
    });
    expect(evidence?.lines[0]).toMatchObject({
      modelCode: "333G",
      oldPriceCents: 8000000,
      newPriceCents: 8150000,
    });
    expect(isOemRepriceDecisionNoteRequired(evidence, "approved")).toBe(true);
    expect(isOemRepriceDecisionNoteRequired(evidence, "rejected")).toBe(false);
  });

  test("does not mislabel standard approvals as OEM repricing", () => {
    expect(extractOemRepriceApprovalEvidence({ rule: "margin" }, {})).toBeNull();
    expect(isOemRepriceDecisionNoteRequired(null, "approved")).toBe(false);
  });
});
