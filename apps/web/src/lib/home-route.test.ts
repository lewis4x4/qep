import { describe, expect, test } from "bun:test";
import { canUseElevatedQrmScopes, resolveHomeRoute } from "./home-route";

describe("resolveHomeRoute", () => {
  test("sends owner to /owner dashboard, admin and manager to QRM", () => {
    expect(resolveHomeRoute("owner")).toBe("/owner");
    expect(resolveHomeRoute("admin")).toBe("/qrm");
    expect(resolveHomeRoute("manager")).toBe("/qrm");
  });

  test("sends every assigned iron role to the Floor role-home", () => {
    expect(resolveHomeRoute("rep", "iron_advisor")).toBe("/floor");
    expect(resolveHomeRoute("rep", "iron_woman")).toBe("/floor");
    expect(resolveHomeRoute("rep", "iron_man")).toBe("/floor");
    expect(resolveHomeRoute("owner", "iron_owner")).toBe("/floor");
    expect(resolveHomeRoute("rep", "iron_parts_counter")).toBe("/floor");
    expect(resolveHomeRoute("manager", "iron_parts_manager")).toBe("/floor");
  });

  test("supports future department roles directly", () => {
    expect(resolveHomeRoute("parts")).toBe("/parts/companion/queue");
    expect(resolveHomeRoute("service")).toBe("/service");
    expect(resolveHomeRoute("rental")).toBe("/rentals");
    expect(resolveHomeRoute("rentals")).toBe("/rentals");
  });

  test("routes stakeholders without an iron role to /brief", () => {
    expect(resolveHomeRoute("client_stakeholder", null, "stakeholder")).toBe("/brief");
    expect(resolveHomeRoute("owner", null, "stakeholder")).toBe("/brief");
  });

  test("lets stakeholder viewers with assigned iron roles land on the Floor", () => {
    expect(resolveHomeRoute("rep", "iron_man", "stakeholder")).toBe("/floor");
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
