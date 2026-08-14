import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PropsWithChildren } from "react";
import type {
  CommandCenterResponse,
  RecommendationCardPayload,
} from "../api/commandCenter.types";
import { MANIFESTO_RISK_STRINGS } from "../lib/commandBrief";

function card(): RecommendationCardPayload {
  return {
    recommendationKey: "deal:abc:revenue_at_risk",
    entityType: "deal",
    entityId: "abc",
    headline: "Bandit chipper replacement package 01 — No activity for 86 days",
    rationale: ["No activity for 86 days (stall threshold 30)."],
    lane: "revenue_at_risk",
    confidence: 0.7,
    score: 2,
    primaryAction: {
      kind: "log_activity",
      label: "Log next touch",
      href: "/qrm/deals/abc",
      payloadId: "abc",
    },
    amount: 125000,
    companyName: "Green Valley Landscaping",
    contactName: "Mike Torres",
    stageName: "Quote Presented",
    observedAt: "2026-04-10T12:00:00Z",
  };
}

function buildPayload(bestMove: RecommendationCardPayload | null): CommandCenterResponse {
  return {
    scope: "mine",
    roleVariant: "iron_woman",
    freshness: {} as CommandCenterResponse["freshness"],
    commandStrip: {
      closableRevenue7d: 0,
      closableRevenue30d: 0,
      atRiskRevenue: 125000,
      blockedDeals: 0,
      overdueFollowUps: 1,
      urgentApprovals: 0,
      narrative: "One overdue follow-up on the board.",
    },
    aiChiefOfStaff: {
      bestMove,
      biggestRisk: null,
      fastestPath: null,
      additional: [],
      source: "rules",
    },
    actionLanes: {
      revenueReady: [],
      revenueAtRisk: bestMove ? [bestMove] : [],
      blockers: [],
    },
    pipelinePressure: {
      stages: [],
      totals: { openCount: 0, openAmount: 0, weightedAmount: 0 },
    },
    revenueRealityBoard: {
      openPipeline: 0,
      weightedRevenue: 0,
      closable7d: 0,
      closable30d: 0,
      atRisk: 125000,
      marginAtRisk: 0,
      stalledQuotes: { count: 0, totalValue: 0 },
      blockedByType: [],
      dgeBlendedDealCount: 0,
      dgeAvailability: "none",
    },
    dealerRealityGrid: {
      tiles: [],
      generatedAt: "2026-04-10T12:00:00Z",
    },
    relationshipEngine: {
      heatingUp: [],
      coolingOff: [],
      competitorRising: [],
      fleetReplacement: [],
      silentKeyAccounts: [],
    },
    knowledgeGaps: {
      topGaps: [],
      repAbsence: [],
      worstFields: [],
      isManagerView: false,
    },
    executiveIntel: {
      forecast: {
        weightedPipeline: 0,
        rawPipeline: 0,
        confidenceScore: 0,
        confidenceLabel: "Weak",
        activeDeals: 0,
        avgInactivityDays: 0,
        depositsVerifiedPct: 0,
      },
      topReps: [],
      marginPressure: {
        flaggedDealCount: 0,
        flaggedDealValue: 0,
        negativeMarginCloses30d: 0,
        medianMarginPct30d: null,
      },
      branchHealth: [],
      isElevatedView: false,
    },
  };
}

let mockPayload = buildPayload(card());

mock.module("../hooks/useCommandCenter", () => ({
  useCommandCenter: () => ({
    data: mockPayload,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
}));

mock.module("../../lib/useIronRoleBlend", () => ({
  useIronRoleBlend: () => ({
    blend: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

const { QrmCommandCenterPage } = await import("../components/QrmCommandCenterPage");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );

  return render(
    <QrmCommandCenterPage
      userRole="manager"
      userId="user-iron-woman"
      userName="Iron Woman"
      userEmail="iron@example.com"
      ironRoleFromProfile="iron_woman"
    />,
    { wrapper: Wrapper },
  );
}

afterEach(() => cleanup());

describe("QrmCommandCenterPage morning brief", () => {
  test("header shows operator role without build-slice badges", () => {
    renderPage();

    expect(screen.getByText(/IRON WOMAN/i)).toBeTruthy();
    expect(screen.queryByText(/Slice 1/i)).toBeNull();
    expect(screen.queryByText(/spine/i)).toBeNull();
  });

  test("risk if ignored uses dealership exposure copy, not manifesto strings", () => {
    renderPage();

    const riskCard = screen.getByText("Risk if ignored").closest("article");
    expect(riskCard).toBeTruthy();
    const riskText = riskCard?.textContent ?? "";

    for (const snippet of MANIFESTO_RISK_STRINGS) {
      expect(riskText.toLowerCase()).not.toContain(snippet);
    }
    expect(riskText).toContain("Green Valley Landscaping");
  });

  test("next move links to the deal when chief-of-staff supplies href", () => {
    renderPage();

    const link = screen.getByRole("link", { name: /Bandit chipper replacement package 01/i });
    expect(link.getAttribute("href")).toBe("/qrm/deals/abc");
    expect(link.textContent).toContain("Log next touch");
  });

  test("next move stays non-clickable without a target id", () => {
    mockPayload = buildPayload(null);
    renderPage();

    expect(screen.queryByRole("link", { name: /Log next touch/i })).toBeNull();
    mockPayload = buildPayload(card());
  });
});
