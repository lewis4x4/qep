import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";

const navigate = mock((_href: string) => undefined);
const fetchRepPriceImpacts = mock(async () => impactResponse());
const createRepriceDraft = mock(async () => ({}));
const applyRepriceDraft = mock(async () => ({
  ok: true,
  action: "apply",
  auditId: "audit-1",
  idempotent: false,
  customerCommunication: "none",
}));
const reverseRepriceApply = mock(async () => ({
  ok: true,
  action: "reverse",
  auditId: "audit-reverse",
  applyAuditId: "audit-apply",
  idempotent: false,
  customerCommunication: "none",
}));
const dismissRepriceImpact = mock(async () => ({}));

function impactResponse() {
  return {
    summary: {
      visibleImpactCount: 1,
      affectedQuoteCount: 1,
      totalDeltaCents: 52_500,
      needsApprovalCount: 1,
    },
    impacts: [
      {
        id: "impact-1",
        eventId: "event-1",
        quotePackageId: "11111111-2222-3333-4444-555555555555",
        dealId: null,
        assignedRepId: "rep-1",
        quoteStatus: "draft",
        quoteUpdatedAt: "2026-07-09T20:00:00Z",
        totalDeltaCents: 52_500,
        maxLineDeltaPct: 5.25,
        oldMarginPct: 18,
        projectedMarginPct: 16.5,
        marginFloorPct: 17,
        belowMarginFloor: true,
        materialityTrigger: "both" as const,
        requiresManagerReview: true,
        approvalRequiredReasons: ["manager_review_policy"],
        oldCommissionCents: 120_000,
        projectedCommissionCents: 105_000,
        commissionDeltaCents: -15_000,
        state: "visible" as const,
        createdAt: "2026-07-09T20:01:00Z",
        updatedAt: "2026-07-09T20:01:00Z",
        lines: [
          {
            id: "line-1",
            modelCode: "TL25",
            make: "Yanmar",
            quantity: 1,
            oldListPriceCents: 1_000_000,
            newListPriceCents: 1_052_500,
            deltaCents: 52_500,
            deltaPct: 5.25,
            sourceLocation: "factory_order",
            isYardStock: false,
            suppressedByStockLock: false,
            suppressionReason: null,
          },
        ],
      },
    ],
  };
}

mock.module("react-router-dom", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams(), () => undefined],
}));
mock.module("@/features/price-intelligence/lib/price-intelligence-api", () => ({
  fetchRepPriceImpacts,
  createRepriceDraft,
  applyRepriceDraft,
  reverseRepriceApply,
  dismissRepriceImpact,
}));
mock.module("@/lib/queryKeys", () => ({
  REP_PRICE_IMPACTS_QUERY_KEY: ["sales", "rep-price-impacts"],
}));
mock.module("@/hooks/use-toast", () => ({ toast: () => undefined }));

const { PriceImpactsPage } = await import("./PriceImpactsPage");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  navigate.mockClear();
  fetchRepPriceImpacts.mockClear();
  applyRepriceDraft.mockClear();
  reverseRepriceApply.mockClear();
  fetchRepPriceImpacts.mockImplementation(async () => impactResponse());
});

afterEach(cleanup);

describe("PriceImpactsPage", () => {
  test("labels OEM-DP10 commission as a projection and shows old, new, and delta", async () => {
    render(<PriceImpactsPage />, { wrapper });

    const commission = await screen.findByRole("region", {
      name: /projected OEM-DP10 commission change/i,
    });
    expect(commission.textContent).toContain("Projected OEM-DP10 commission");
    expect(commission.textContent).toContain(
      "not final commission-ledger truth",
    );
    expect(commission.textContent).toContain("Old+$1,200");
    expect(commission.textContent).toContain("New+$1,050");
    expect(commission.textContent).toContain("Delta-$150");
    expect(screen.getByText(/customers are never auto-sent/i)).toBeTruthy();
  });

  test("renders a direct accessible error state without stale impact cards", async () => {
    fetchRepPriceImpacts.mockImplementation(async () => {
      throw new Error("offline");
    });
    render(<PriceImpactsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/OEM impacts could not load/i)).toBeTruthy();
    });
    expect(screen.queryByText("Quote 11111111")).toBeNull();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  test("offers one-tap apply only for the current approved draft", async () => {
    const response = impactResponse();
    fetchRepPriceImpacts.mockImplementation(async () => ({
      ...response,
      impacts: response.impacts.map((impact) => ({
        ...impact,
        state: "approved" as const,
        currentDraft: {
          id: "draft-approved",
          status: "approved" as const,
          approvalCaseId: "approval-1",
          appliedAt: null,
          reversedAt: null,
        },
      })),
    }));
    render(<PriceImpactsPage />, { wrapper });

    const applyButton = await screen.findByRole("button", {
      name: /apply approved re-price/i,
    });
    fireEvent.click(applyButton);

    await waitFor(() => expect(applyRepriceDraft).toHaveBeenCalledTimes(1));
    expect(applyRepriceDraft.mock.calls[0]?.[0]).toBe("draft-approved");
  });

  test("shows append-only history and confirms an eligible audited reversal", async () => {
    const response = impactResponse();
    fetchRepPriceImpacts.mockImplementation(async () => ({
      ...response,
      impacts: response.impacts.map((impact) => ({
        ...impact,
        state: "applied" as const,
        currentDraft: {
          id: "draft-applied",
          status: "applied" as const,
          approvalCaseId: "approval-1",
          appliedAt: "2026-07-09T20:02:00Z",
          reversedAt: null,
        },
        history: [{
          id: "audit-apply",
          action: "apply" as const,
          applyAuditId: null,
          draftId: "draft-applied",
          actorRole: "rep",
          createdAt: "2026-07-09T20:02:00Z",
          beforeVersionNumber: 3,
          afterVersionNumber: 4,
          canReverse: true,
          reversalDeadline: "2026-07-16T20:02:00Z",
          reversedByAuditId: null,
          customerCommunication: "none" as const,
        }],
      })),
    }));
    render(<PriceImpactsPage />, { wrapper });

    const reverseButton = await screen.findByRole("button", {
      name: /reverse audited apply/i,
    });
    expect(screen.getByRole("region", {
      name: /OEM re-price audit history/i,
    })).toBeTruthy();
    fireEvent.click(reverseButton);
    fireEvent.click(await screen.findByRole("button", {
      name: /confirm audited reversal/i,
    }));

    await waitFor(() => expect(reverseRepriceApply).toHaveBeenCalledTimes(1));
    expect(reverseRepriceApply.mock.calls[0]?.[0]).toBe("audit-apply");
  });
});
