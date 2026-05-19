import { describe, expect, test } from "bun:test";
import {
  canAccessFloorSurface,
  canAccessManagerAdminRoute,
  canAccessManagerAdminSurface,
  canAccessQrmSurface,
  canUseElevatedQrmScopes,
  resolveManagerAdminRouteRedirect,
  resolveHomeRoute,
} from "./home-route";

describe("resolveHomeRoute", () => {
  test("sends owner to /owner dashboard, admin and manager to QRM", () => {
    expect(resolveHomeRoute("owner")).toBe("/owner");
    expect(resolveHomeRoute("admin")).toBe("/qrm");
    expect(resolveHomeRoute("manager")).toBe("/qrm");
  });

  test("keeps core business roles on their role-scoped homes", () => {
    expect(resolveHomeRoute("rep", "iron_advisor")).toBe("/sales/today");
    expect(resolveHomeRoute("rep", "iron_woman")).toBe("/sales/today");
    expect(resolveHomeRoute("rep", "iron_man")).toBe("/sales/today");
    expect(resolveHomeRoute("owner", "iron_owner")).toBe("/owner");
    expect(resolveHomeRoute("manager", "iron_parts_manager")).toBe("/qrm");
  });

  test("falls back to /floor only for non-core roles with floor mode/iron assignment", () => {
    expect(resolveHomeRoute("client_stakeholder", "iron_man", "internal")).toBe("/floor");
    expect(resolveHomeRoute("client_stakeholder", null, "internal", true)).toBe("/floor");
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

  test("keeps stakeholders on /brief regardless of assigned iron roles", () => {
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

describe("route surface access helpers", () => {
  test("rep cannot access /floor, /qrm, or manager/admin surfaces", () => {
    expect(canAccessFloorSurface("rep")).toBe(false);
    expect(canAccessQrmSurface("rep")).toBe(false);
    expect(canAccessManagerAdminSurface("rep")).toBe(false);
  });

  test("manager/admin can access /floor, /qrm, and manager/admin surfaces", () => {
    expect(canAccessFloorSurface("manager")).toBe(true);
    expect(canAccessFloorSurface("admin")).toBe(true);
    expect(canAccessQrmSurface("manager")).toBe(true);
    expect(canAccessQrmSurface("admin")).toBe(true);
    expect(canAccessManagerAdminSurface("manager")).toBe(true);
    expect(canAccessManagerAdminSurface("admin")).toBe(true);
  });

  test("manager/admin route decisions redirect reps to homeRoute and allow manager/admin", () => {
    const repHome = resolveHomeRoute("rep");
    expect(canAccessManagerAdminRoute("rep", "qrm_activities_templates")).toBe(false);
    expect(resolveManagerAdminRouteRedirect("rep", repHome, "qrm_activities_templates")).toBe(
      "/sales/today",
    );
    expect(resolveManagerAdminRouteRedirect("rep", repHome, "admin_sequences")).toBe(
      "/sales/today",
    );
    expect(resolveManagerAdminRouteRedirect("rep", repHome, "admin_duplicates")).toBe(
      "/sales/today",
    );

    expect(canAccessManagerAdminRoute("manager", "qrm_activities_templates")).toBe(true);
    expect(resolveManagerAdminRouteRedirect("manager", "/qrm", "qrm_activities_templates")).toBe(
      null,
    );
  });
});
