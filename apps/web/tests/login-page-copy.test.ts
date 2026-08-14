import { describe, expect, test } from "bun:test";
import { loginFormCopy, loginMarketingCopy } from "../src/lib/login-page-copy";

describe("login page copy", () => {
  test("operator and portal surfaces use distinct marketing headlines", () => {
    const operator = loginMarketingCopy("internal");
    const portal = loginMarketingCopy("portal");

    expect(operator.headline).toContain("operating system");
    expect(portal.headline).toContain("fleet");
    expect(operator.badgeLabel).not.toBe(portal.badgeLabel);
    expect(operator.headline).not.toBe(portal.headline);
  });

  test("operator marketing avoids self-referential login-screen commentary", () => {
    const operator = loginMarketingCopy("internal");
    const serialized = JSON.stringify(operator).toLowerCase();

    expect(serialized).not.toContain("login screen");
    expect(serialized).not.toContain("saas filler");
    expect(operator.heroMetrics.every((metric) => /\d/.test(metric.value))).toBe(false);
  });

  test("portal form copy positions customer portal access", () => {
    const portalForm = loginFormCopy("portal");
    expect(portalForm.headline).toBe("Portal access");
    expect(portalForm.subcopy).toContain("customer portal");
    expect(portalForm.badgeLabel).toContain("customer");
  });

  test("portal marketing does not reuse operator yard positioning", () => {
    const operator = loginMarketingCopy("internal");
    const portal = loginMarketingCopy("portal");

    expect(portal.badgeLabel).not.toContain("yard");
    expect(portal.badgeLabel).not.toContain("counter");
    expect(operator.badgeLabel).toContain("Sales");
  });
});
