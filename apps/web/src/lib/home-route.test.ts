import { describe, expect, test } from "bun:test";
import { canUseElevatedQrmScopes, resolveHomeRoute } from "./home-route";

describe("resolveHomeRoute", () => {
  test("sends owner to /owner dashboard, admin and manager to QRM", () => {
    expect(resolveHomeRoute("owner")).toBe("/owner");
    expect(resolveHomeRoute("admin")).toBe("/qrm");
    expect(resolveHomeRoute("manager")).toBe("/qrm");
  });

  test("keeps reps on sales unless their iron role maps to another department", () => {
    expect(resolveHomeRoute("rep", "iron_advisor")).toBe("/sales/today");
    expect(resolveHomeRoute("rep", "iron_woman")).toBe("/parts/companion/queue");
    expect(resolveHomeRoute("rep", "iron_man")).toBe("/service");
  });

  test("supports future department roles directly", () => {
    expect(resolveHomeRoute("parts")).toBe("/parts/companion/queue");
    expect(resolveHomeRoute("service")).toBe("/service");
    expect(resolveHomeRoute("rental")).toBe("/rentals");
    expect(resolveHomeRoute("rentals")).toBe("/rentals");
  });

  test("routes stakeholders to /brief regardless of role or iron role", () => {
    expect(resolveHomeRoute("client_stakeholder", null, "stakeholder")).toBe("/brief");
    // Audience overrides even a role that would otherwise route elsewhere.
    expect(resolveHomeRoute("owner", null, "stakeholder")).toBe("/brief");
    expect(resolveHomeRoute("rep", "iron_man", "stakeholder")).toBe("/brief");
  });

  test("does not route internal users to /brief", () => {
    expect(resolveHomeRoute("owner", null, "internal")).toBe("/owner");
    expect(resolveHomeRoute("owner", null, null)).toBe("/owner");
  });
});

describe("canUseElevatedQrmScopes", () => {
  test("allows elevated business roles and iron managers to start broad", () => {
    expect(canUseElevatedQrmScopes("owner")).toBe(true);
    expect(canUseElevatedQrmScopes("admin")).toBe(true);
    expect(canUseElevatedQrmScopes("manager")).toBe(true);
    expect(canUseElevatedQrmScopes("rep", "iron_manager")).toBe(true);
    expect(canUseElevatedQrmScopes("rep", "iron_advisor")).toBe(false);
  });
});
