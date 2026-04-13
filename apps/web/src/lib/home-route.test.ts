import { describe, expect, test } from "bun:test";
import { canUseElevatedQrmScopes, resolveHomeRoute } from "./home-route";

describe("resolveHomeRoute", () => {
  test("sends owner, admin, and manager users to QRM", () => {
    expect(resolveHomeRoute("owner")).toBe("/qrm");
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
