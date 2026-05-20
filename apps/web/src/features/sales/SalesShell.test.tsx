import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

mock.module("./components/SalesTopHeader", () => ({
  SalesTopHeader: () => <div data-testid="sales-top-header" />,
}));

mock.module("./components/SalesOfflineBanner", () => ({
  SalesOfflineBanner: () => <div data-testid="sales-offline-banner" />,
}));

mock.module("./lib/sync-engine", () => ({
  registerSyncOnReconnect: () => () => undefined,
}));

import { SalesShell } from "./SalesShell";

afterEach(cleanup);

describe("SalesShell bottom nav scroll contract", () => {
  test("locks the viewport and makes the shell main the owned scroll root", () => {
    render(
      <MemoryRouter initialEntries={["/sales/today"]}>
        <Routes>
          <Route element={<SalesShell />}>
            <Route path="/sales/today" element={<div>Today body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const shell = screen.getByTestId("sales-shell");
    expect(shell.className).toContain("h-[100dvh]");
    expect(shell.className).toContain("overflow-hidden");

    const scrollRoot = screen.getByTestId("sales-shell-scroll-root") as HTMLElement;
    expect(scrollRoot.className).toContain("overflow-y-auto");
    expect(scrollRoot.getAttribute("data-scroll-owner")).toBe("sales-shell");
    expect(scrollRoot.style.paddingBottom).toBe("var(--sales-shell-bottom-scroll-padding)");
  });
});
