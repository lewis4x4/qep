import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { BottomTabBar, SALES_BOTTOM_TAB_BAR_HEIGHT } from "./BottomTabBar";
import { MOBILE } from "../lib/mobile-design-tokens";

afterEach(cleanup);

describe("BottomTabBar navigation semantics", () => {
  test("uses nav links with aria-current for the active route", () => {
    render(
      <MemoryRouter initialEntries={["/sales/pipeline"]}>
        <BottomTabBar />
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "Sales navigation" });
    expect(nav.getAttribute("role")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();

    const pipeline = screen.getByRole("link", { name: "Pipeline" });
    expect(pipeline.getAttribute("href")).toBe("/sales/pipeline");
    expect(pipeline.getAttribute("aria-current")).toBe("page");
    expect(pipeline.className).toContain("min-h-12");
    expect(screen.getByRole("link", { name: "Today" }).hasAttribute("aria-current")).toBe(false);
  });
});

describe("BottomTabBar height contract", () => {
  test("exposes the shared 64px tab height as a test hook", () => {
    render(
      <MemoryRouter initialEntries={["/sales/today"]}>
        <BottomTabBar />
      </MemoryRouter>,
    );

    const nav = screen.getByTestId("sales-bottom-tab-bar");
    expect(SALES_BOTTOM_TAB_BAR_HEIGHT).toBe(MOBILE.bottomTabBarHeight);
    expect(nav.getAttribute("data-bottom-tab-height")).toBe(String(MOBILE.bottomTabBarHeight));
  });

  test("reserves safe-area inset exactly once inside the fixed height", () => {
    render(
      <MemoryRouter initialEntries={["/sales/today"]}>
        <BottomTabBar />
      </MemoryRouter>,
    );

    const nav = screen.getByTestId("sales-bottom-tab-bar") as HTMLElement;
    expect(nav.className).not.toContain("safe-area-bottom");
    expect(nav.getAttribute("data-safe-area-contract")).toBe(
      "height-includes-padding-bottom-once",
    );
    expect(nav.style.height).toBe("var(--sales-shell-bottom-offset)");
    expect(nav.style.paddingBottom).toBe("var(--sales-shell-safe-area-bottom)");
  });
});
