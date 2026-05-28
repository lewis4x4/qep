import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  formatCentsCompact,
  OemPriceImpactCard,
  topPriceImpacts,
} from "./OemPriceImpactCard";
import type { RepPriceImpact } from "@/features/price-intelligence/lib/price-intelligence-api";

afterEach(cleanup);

function impact(overrides: Partial<RepPriceImpact> = {}): RepPriceImpact {
  return {
    id: overrides.id ?? "impact-1",
    eventId: "event-1",
    quotePackageId: overrides.quotePackageId ?? "11111111-2222-3333-4444-555555555555",
    dealId: null,
    assignedRepId: "rep-1",
    quoteStatus: "sent",
    quoteUpdatedAt: "2026-05-20T18:00:00Z",
    totalDeltaCents: overrides.totalDeltaCents ?? 525000,
    maxLineDeltaPct: 3.2,
    oldMarginPct: 18,
    projectedMarginPct: 16.5,
    marginFloorPct: 17,
    belowMarginFloor: true,
    materialityTrigger: "both",
    requiresManagerReview: overrides.requiresManagerReview ?? true,
    approvalRequiredReasons: ["manager_review_policy"],
    oldCommissionCents: 120000,
    projectedCommissionCents: 105000,
    commissionDeltaCents: -15000,
    state: "visible",
    createdAt: "2026-05-20T18:01:00Z",
    updatedAt: "2026-05-20T18:01:00Z",
    lines: [
      {
        id: "line-1",
        modelCode: "TL25",
        make: "Yanmar",
        quantity: 1,
        oldListPriceCents: 1000000,
        newListPriceCents: 1052500,
        deltaCents: 52500,
        deltaPct: 5.25,
        sourceLocation: "factory",
        isYardStock: false,
        suppressedByStockLock: false,
        suppressionReason: null,
      },
    ],
    ...overrides,
  };
}

describe("OemPriceImpactCard", () => {
  test("renders nothing when there are no visible impacts", () => {
    const { container } = render(
      <OemPriceImpactCard
        summary={{ visibleImpactCount: 0, affectedQuoteCount: 0, totalDeltaCents: 0, needsApprovalCount: 0 }}
        impacts={[]}
        onReview={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("shows count, exposure, top quotes, approval cue, and no-auto-send copy", () => {
    render(
      <OemPriceImpactCard
        summary={{ visibleImpactCount: 2, affectedQuoteCount: 2, totalDeltaCents: 845000, needsApprovalCount: 1 }}
        impacts={[
          impact({ id: "small", quotePackageId: "aaaaaaaa-1111-2222-3333-444444444444", totalDeltaCents: 320000, requiresManagerReview: false }),
          impact({ id: "large", quotePackageId: "bbbbbbbb-1111-2222-3333-444444444444", totalDeltaCents: 525000, requiresManagerReview: true }),
        ]}
        onReview={() => undefined}
      />,
    );

    expect(screen.getByText(/2 quotes affected · \+\$8.4K exposure/)).toBeTruthy();
    expect(screen.getByText(/No emails are sent automatically/)).toBeTruthy();
    expect(screen.getByText("Quote BBBBBBBB")).toBeTruthy();
    expect(screen.getByText("approval")).toBeTruthy();
  });

  test("calls onReview when the review CTA is pressed", () => {
    const onReview = mock(() => undefined);
    render(
      <OemPriceImpactCard
        summary={{ visibleImpactCount: 1, affectedQuoteCount: 1, totalDeltaCents: 525000, needsApprovalCount: 1 }}
        impacts={[impact()]}
        onReview={onReview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /review re-prices/i }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  test("sorts top impacts by absolute exposure", () => {
    expect(topPriceImpacts([
      impact({ id: "a", totalDeltaCents: 1000 }),
      impact({ id: "b", totalDeltaCents: -9000 }),
      impact({ id: "c", totalDeltaCents: 5000 }),
    ], 2).map((row) => row.id)).toEqual(["b", "c"]);
  });

  test("formats compact cents with sign", () => {
    expect(formatCentsCompact(845000)).toBe("+$8.4K");
    expect(formatCentsCompact(-125000)).toBe("-$1.3K");
  });
});
