import { describe, expect, test } from "bun:test";
import { MOBILE } from "./mobile-design-tokens";

describe("MOBILE design tokens", () => {
  test("exposes chrome heights matching SalesShell layout", () => {
    expect(MOBILE.topHeaderHeight).toBe(56);
    expect(MOBILE.bottomTabBarHeight).toBe(64);
    expect(MOBILE.stickyActionBarHeight).toBe(64);
  });

  test("locks 44pt minimum touch target", () => {
    expect(MOBILE.minTouchTarget).toBeGreaterThanOrEqual(44);
  });

  test("typography ramp covers the five required slots", () => {
    expect(MOBILE.text.pageTitle).toBeTruthy();
    expect(MOBILE.text.sectionTitle).toBeTruthy();
    expect(MOBILE.text.cardTitle).toBeTruthy();
    expect(MOBILE.text.body).toBeTruthy();
    expect(MOBILE.text.label).toBeTruthy();
  });

  test("breakpoints follow tailwind defaults", () => {
    expect(MOBILE.breakpoints.sm).toBe(640);
    expect(MOBILE.breakpoints.md).toBe(768);
    expect(MOBILE.breakpoints.lg).toBe(1024);
  });
});
