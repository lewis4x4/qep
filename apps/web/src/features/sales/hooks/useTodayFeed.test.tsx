import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const fetchTodayBriefing = mock(async () => null);
const fetchRepPipeline = mock(async () => []);
const fetchRepPriceImpacts = mock(async () => ({
  summary: {
    visibleImpactCount: 0,
    affectedQuoteCount: 0,
    totalDeltaCents: 0,
    needsApprovalCount: 0,
  },
  impacts: [],
}));

mock.module("../lib/sales-api", () => ({
  fetchTodayBriefing,
  fetchRepPipeline,
}));

mock.module("@/features/price-intelligence/lib/price-intelligence-api", () => ({
  fetchRepPriceImpacts,
}));

mock.module("@/lib/queryKeys", () => ({
  REP_PRICE_IMPACTS_QUERY_KEY: ["sales", "rep-price-impacts"],
}));

const { useTodayFeed } = await import("./useTodayFeed");

let queuedRaf: (() => void) | null = null;
let queuedIdle: (() => void) | null = null;
let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;
const originalRequestIdleCallback = (
  window as Window & { requestIdleCallback?: (callback: () => void) => number }
).requestIdleCallback;
const originalCancelIdleCallback = (
  window as Window & { cancelIdleCallback?: (id: number) => void }
).cancelIdleCallback;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchTodayBriefing.mockClear();
  fetchRepPipeline.mockClear();
  fetchRepPriceImpacts.mockClear();
  queuedRaf = null;
  queuedIdle = null;

  originalRequestAnimationFrame = window.requestAnimationFrame;
  originalCancelAnimationFrame = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queuedRaf = () => callback(0);
    return 1;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  (
    window as Window & { requestIdleCallback?: (callback: () => void) => number }
  ).requestIdleCallback = (callback: () => void) => {
    queuedIdle = callback;
    return 1;
  };
  (
    window as Window & { cancelIdleCallback?: (id: number) => void }
  ).cancelIdleCallback = () => {};
});

afterEach(() => {
  cleanup();
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
  (
    window as Window & { requestIdleCallback?: (callback: () => void) => number }
  ).requestIdleCallback = originalRequestIdleCallback;
  (
    window as Window & { cancelIdleCallback?: (id: number) => void }
  ).cancelIdleCallback = originalCancelIdleCallback;
});

describe("useTodayFeed", () => {
  test("keeps briefing and OEM impacts out of the first-paint loading gate", async () => {
    const { result } = renderHook(() => useTodayFeed(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRepPipeline).toHaveBeenCalledTimes(1);
    expect(fetchRepPriceImpacts).not.toHaveBeenCalled();
    expect(fetchTodayBriefing).not.toHaveBeenCalled();
    expect(result.current.priceImpactsLoading).toBe(false);

    act(() => {
      queuedRaf?.();
      queuedIdle?.();
    });

    await waitFor(() => expect(fetchTodayBriefing).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchRepPriceImpacts).toHaveBeenCalledTimes(1));
    expect(result.current.isLoading).toBe(false);
  });
});
