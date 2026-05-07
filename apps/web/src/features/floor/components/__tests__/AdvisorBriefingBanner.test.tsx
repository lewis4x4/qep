import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

let todayFeedState: any;
let advisorStats: { activeDealCount: number; totalValueCents: number; decisionCount: number };
let advisorStatsError: Error | null;

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "rep-1" },
    profile: { id: "rep-1", full_name: "Brian Lewis" },
  }),
}));

mock.module("@/features/sales/hooks/useTodayFeed", () => ({
  useTodayFeed: () => todayFeedState,
}));

mock.module("@/features/floor/lib/advisor-home-stats", () => ({
  fetchAdvisorPipelineStats: async () => {
    if (advisorStatsError) throw advisorStatsError;
    return advisorStats;
  },
  formatCompactUsd: (cents: number) => {
    const dollars = cents / 100;
    if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
    if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
    return `$${Math.round(dollars).toLocaleString()}`;
  },
}));

const { AdvisorBriefingBanner } = await import("../AdvisorBriefingBanner");

function Providers({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderBanner() {
  render(
    <Providers>
      <AdvisorBriefingBanner />
    </Providers>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  advisorStats = { activeDealCount: 0, totalValueCents: 0, decisionCount: 0 };
  advisorStatsError = null;
  todayFeedState = {
    briefing: null,
    liveStats: { deals_in_pipeline: 0, total_pipeline_value: 0, quotes_sent_this_week: 0 },
    livePriorityActions: [],
    pipeline: [],
    timeOfDay: "evening",
    isLoading: false,
    error: null,
    briefingError: null,
    pipelineError: null,
    hasBriefing: false,
  };
});

afterEach(() => {
  cleanup();
});

describe("AdvisorBriefingBanner", () => {
  test("uses QRM-backed advisor stats when the sales feed is empty", async () => {
    advisorStats = { activeDealCount: 2, totalValueCents: 25_000_000, decisionCount: 1 };

    renderBanner();

    await waitFor(() => {
      expect(screen.getByText(/\$250K in QRM active pipeline/i)).toBeTruthy();
    });
    expect(screen.getByText(/2 active deals/i)).toBeTruthy();
    expect(screen.getByText(/1 at decision stage/i)).toBeTruthy();
  });

  test("falls back to Sales Companion signals when QRM exists but is empty", async () => {
    todayFeedState = {
      ...todayFeedState,
      liveStats: { deals_in_pipeline: 1, total_pipeline_value: 75_000, quotes_sent_this_week: 0 },
    };

    renderBanner();

    await waitFor(() => {
      expect(screen.getByText(/\$75,000 in Sales Companion pipeline/i)).toBeTruthy();
    });
    expect(screen.queryByText(/No quote work queued yet/i)).toBeNull();
  });

  test("renders a true empty state instead of a greeting-only card", async () => {
    renderBanner();

    await waitFor(() => {
      expect(screen.getByText(/No quote work queued yet\. Start a quote or dictate one from your next customer conversation\./i)).toBeTruthy();
    });
    expect(screen.getByText("Good evening, Brian")).toBeTruthy();
  });

  test("keeps rendering QRM stats when the daily feed is broken", async () => {
    todayFeedState = {
      ...todayFeedState,
      error: new Error("daily feed failed"),
      briefingError: new Error("daily feed failed"),
    };
    advisorStats = { activeDealCount: 1, totalValueCents: 10_000_000, decisionCount: 0 };

    renderBanner();

    await waitFor(() => {
      expect(screen.getByText(/Daily briefing unavailable; showing live advisor signals/i)).toBeTruthy();
    });
    expect(screen.getByText(/\$100K in QRM active pipeline/i)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load advisor briefing signals/i)).toBeNull();
  });

  test("shows a broken-data error only when all feed and QRM sources fail", async () => {
    todayFeedState = {
      ...todayFeedState,
      error: new Error("sales feed failed"),
      briefingError: new Error("daily feed failed"),
      pipelineError: new Error("pipeline failed"),
    };
    advisorStatsError = new Error("qrm failed");

    renderBanner();

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load advisor briefing signals right now\. Start a quote or dictate the customer conversation/i)).toBeTruthy();
    });
    expect(screen.queryByText("Good evening, Brian")).toBeNull();
  });
});
