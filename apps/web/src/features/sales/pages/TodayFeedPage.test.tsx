import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const navigate = mock((_href: string) => undefined);
const refetchPriceImpacts = mock(async () => ({ data: undefined }));
const openBar = mock(() => undefined);

let todayFeed = {
  briefing: null,
  liveStats: {
    deals_in_pipeline: 0,
    total_pipeline_value: 0,
    quotes_sent_this_week: 0,
  },
  livePriorityActions: [],
  pipeline: [],
  priceImpacts: null as null | {
    summary: {
      visibleImpactCount: number;
      affectedQuoteCount: number;
      totalDeltaCents: number;
      needsApprovalCount: number;
    };
    impacts: unknown[];
  },
  priceImpactsLoading: false,
  priceImpactsError: null as Error | null,
  refetchPriceImpacts,
  timeOfDay: "morning" as const,
  isLoading: false,
};

mock.module("react-router-dom", () => ({ useNavigate: () => navigate }));
mock.module("../hooks/useTodayFeed", () => ({ useTodayFeed: () => todayFeed }));
mock.module("../hooks/useRepStreaks", () => ({
  useRepStreaks: () => ({
    currentStreak: 0,
    longestStreak: 0,
    lastActiveAt: null,
    isLoading: false,
  }),
}));
mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: { full_name: "Riley Rep", email: "riley@example.test", role: "rep" },
  }),
}));
mock.module("@/lib/iron/store", () => ({
  useIronStore: () => ({ openBar }),
}));
mock.module("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

for (const [path, exportName] of [
  ["../components/EveningBriefingHero", "EveningBriefingHero"],
  ["../components/SalesNarrativeBlock", "SalesNarrativeBlock"],
  ["../components/SalesActionsBlock", "SalesActionsBlock"],
  ["../components/SalesQuickTools", "SalesQuickTools"],
  ["../components/TomorrowFirstMove", "TomorrowFirstMove"],
  ["../components/LiveSignalsStrip", "LiveSignalsStrip"],
  ["../components/StreakBadge", "StreakBadge"],
  ["../components/TodayFeedSkeleton", "TodayFeedSkeleton"],
  ["../components/PrepCard", "PrepCard"],
  ["../components/ActionItemCard", "ActionItemCard"],
  ["../components/LogVisitFlow", "LogVisitFlow"],
] as const) {
  mock.module(path, () => ({
    [exportName]: () => <div data-testid={`mock-${exportName}`} />,
  }));
}

const { TodayFeedPage } = await import("./TodayFeedPage");

beforeEach(() => {
  navigate.mockClear();
  refetchPriceImpacts.mockClear();
  openBar.mockClear();
  todayFeed = {
    ...todayFeed,
    priceImpacts: null,
    priceImpactsLoading: false,
    priceImpactsError: null,
    isLoading: false,
  };
});

afterEach(cleanup);

describe("TodayFeedPage OEM impact path", () => {
  test("quiet impacts produce no chip or empty OEM card", () => {
    todayFeed = {
      ...todayFeed,
      priceImpacts: {
        summary: {
          visibleImpactCount: 0,
          affectedQuoteCount: 0,
          totalDeltaCents: 0,
          needsApprovalCount: 0,
        },
        impacts: [],
      },
    };

    render(<TodayFeedPage />);
    expect(screen.queryByText(/OEM price impact/i)).toBeNull();
    expect(screen.queryByTestId("oem-price-impact-card-empty")).toBeNull();
  });

  test("material impacts navigate from the Today chip to the review queue", () => {
    todayFeed = {
      ...todayFeed,
      priceImpacts: {
        summary: {
          visibleImpactCount: 1,
          affectedQuoteCount: 1,
          totalDeltaCents: 125_000,
          needsApprovalCount: 1,
        },
        impacts: [{ id: "impact-1" }],
      },
    };

    render(<TodayFeedPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /review 1 quote affected by an OEM price update/i,
      }),
    );
    expect(navigate).toHaveBeenCalledWith("/sales/price-impacts");
  });

  test("an OEM query failure leaves Today usable and offers retry", () => {
    todayFeed = {
      ...todayFeed,
      priceImpactsError: new Error("offline"),
    };

    render(<TodayFeedPage />);
    expect(screen.getByRole("heading", { name: "Today", level: 1 })).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetchPriceImpacts).toHaveBeenCalledTimes(1);
  });
});
