import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canAccessFloorSurface,
  canAccessManagerAdminRoute,
  canAccessManagerAdminSurface,
  canAccessQrmSurface,
  resolveManagerAdminRouteRedirect,
  resolveHomeRoute,
} from "./home-route";

describe("SC-2 app routing policy via centralized home-route helpers", () => {
  const appSource = readFileSync(resolve(import.meta.dir, "../App.tsx"), "utf8");

  test("rep route policy resolves guarded surface deep-links back to homeRoute", () => {
    const homeRoute = resolveHomeRoute("rep", "iron_advisor", "internal", false);
    expect(homeRoute).toBe("/sales/today");
    expect(canAccessFloorSurface("rep")).toBe(false);
    expect(canAccessQrmSurface("rep")).toBe(false);
    expect(canAccessManagerAdminSurface("rep")).toBe(false);
  });

  test("manager and admin keep access to /floor, /qrm, and manager/admin-only surfaces", () => {
    const managerHome = resolveHomeRoute("manager", "iron_manager", "internal", false);
    const adminHome = resolveHomeRoute("admin", "iron_woman", "internal", false);
    expect(managerHome).toBe("/qrm");
    expect(adminHome).toBe("/qrm");

    expect(canAccessFloorSurface("manager")).toBe(true);
    expect(canAccessFloorSurface("admin")).toBe(true);
    expect(canAccessQrmSurface("manager")).toBe(true);
    expect(canAccessQrmSurface("admin")).toBe(true);
    expect(canAccessManagerAdminSurface("manager")).toBe(true);
    expect(canAccessManagerAdminSurface("admin")).toBe(true);
  });

  test("/dashboard canonical redirect target remains role-scoped homeRoute", () => {
    expect(resolveHomeRoute("rep")).toBe("/sales/today");
    expect(resolveHomeRoute("manager")).toBe("/qrm");
    expect(resolveHomeRoute("owner")).toBe("/owner");
  });

  test("manager/admin route decision helper drives rep redirects for SC-2 surfaces", () => {
    const repHome = resolveHomeRoute("rep");
    for (const key of [
      "qrm_activities_templates",
      "admin_sequences",
      "admin_duplicates",
    ] as const) {
      expect(canAccessManagerAdminRoute("rep", key)).toBe(false);
      expect(resolveManagerAdminRouteRedirect("rep", repHome, key)).toBe("/sales/today");
      expect(canAccessManagerAdminRoute("manager", key)).toBe(true);
      expect(resolveManagerAdminRouteRedirect("manager", "/qrm", key)).toBe(null);
    }
  });

  test("App SC-2 routes reference centralized helpers and homeRoute redirects", () => {
    expect(appSource).toContain('path="/qrm/activities/templates"');
    expect(appSource).toContain('canAccessManagerAdminRoute(profile.role, "qrm_activities_templates")');
    expect(appSource).toContain('path="/admin/sequences"');
    expect(appSource).toContain('canAccessManagerAdminRoute(profile.role, "admin_sequences")');
    expect(appSource).toContain('path="/admin/duplicates"');
    expect(appSource).toContain('canAccessManagerAdminRoute(profile.role, "admin_duplicates")');
    expect(appSource).toContain('Navigate to={managerAdminTemplatesRedirect ?? homeRoute} replace');
    expect(appSource).toContain('Navigate to={managerAdminSequencesRedirect ?? homeRoute} replace');
    expect(appSource).toContain('Navigate to={managerAdminDuplicatesRedirect ?? homeRoute} replace');
  });
});
