/**
 * WAVE phase 1 — SalesRoutes wires the quote-builder + quote-list
 * pages under `/sales/quotes`, `/sales/quotes/new`, and
 * `/sales/quotes/:quoteId` inside the SalesShell. This test asserts
 * the route configuration without lazy-loading the heavy pages — we
 * stub the page modules so we can verify the matched path without
 * pulling in the full Quote Builder dependency graph.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

mock.module("../pages/TodayFeedPage", () => ({
  TodayFeedPage: () => <div data-testid="today-feed-page">today</div>,
}));
mock.module("../pages/PipelineBoardPage", () => ({
  PipelineBoardPage: () => <div data-testid="pipeline-board-page">pipeline</div>,
}));
mock.module("../pages/CustomerListPage", () => ({
  CustomerListPage: () => <div data-testid="customer-list-page">customers</div>,
}));
mock.module("../pages/CustomerDetailPage", () => ({
  CustomerDetailPage: () => <div data-testid="customer-detail-page">customer</div>,
}));
mock.module("../../quote-builder/pages/QuoteListPage", () => ({
  QuoteListPage: () => <div data-testid="quote-list-page">quote-list</div>,
}));
mock.module("../../quote-builder/pages/QuoteBuilderV2Page", () => ({
  QuoteBuilderV2Page: () => <div data-testid="quote-builder-page">quote-builder</div>,
}));
// SalesShell pulls in sync-engine + auth — neutralize side effects.
mock.module("../lib/sync-engine", () => ({
  registerSyncOnReconnect: () => () => {},
}));
mock.module("../components/SalesTopHeader", () => ({
  SalesTopHeader: () => <header data-testid="sales-top-header" />,
}));
mock.module("../components/BottomTabBar", () => ({
  BottomTabBar: () => <nav data-testid="bottom-tab-bar" />,
}));
mock.module("../components/SalesOfflineBanner", () => ({
  SalesOfflineBanner: () => null,
}));

import { SalesRoutes } from "../SalesRoutes";

afterEach(cleanup);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sales/*" element={<SalesRoutes />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SalesRoutes — WAVE phase 1 quote routes", () => {
  test("/sales/quotes mounts the quote list inside SalesShell", async () => {
    renderAt("/sales/quotes");
    await waitFor(() => {
      expect(screen.getByTestId("quote-list-page")).toBeTruthy();
    });
    // SalesShell chrome is present
    expect(screen.getByTestId("sales-top-header")).toBeTruthy();
    expect(screen.getByTestId("bottom-tab-bar")).toBeTruthy();
  });

  test("/sales/quotes/new mounts the QuoteBuilder", async () => {
    renderAt("/sales/quotes/new");
    await waitFor(() => {
      expect(screen.getByTestId("quote-builder-page")).toBeTruthy();
    });
  });

  test("/sales/quotes/:quoteId mounts the QuoteBuilder", async () => {
    renderAt("/sales/quotes/qp_abc_123");
    await waitFor(() => {
      expect(screen.getByTestId("quote-builder-page")).toBeTruthy();
    });
  });

  test("/sales index redirects to /sales/today", async () => {
    renderAt("/sales");
    await waitFor(() => {
      expect(screen.getByTestId("today-feed-page")).toBeTruthy();
    });
  });
});
