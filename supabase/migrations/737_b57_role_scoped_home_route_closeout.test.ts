import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHomeRoute, canAccessFloorSurface, canAccessQrmSurface, canAccessManagerAdminRoute, canAccessServiceOperations, canAccessPartsOperations } from "../../apps/web/src/lib/home-route";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();
const compactCloseout = compact(readText("supabase", "migrations", "737_b57_role_scoped_home_route_closeout.sql"));
const appSource = readText("apps", "web", "src", "App.tsx");

describe("737 historical closeout and current role home behavior", () => {
  it("records only B5.7 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b5.7'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).not.toContain("where task_id = 'b5.6'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.8'");
  });
  it("retains the historical manual/database-apply verification limits", () => {
    expect(compactCloseout).toContain("no credentialed browser uat");
    expect(compactCloseout).toContain("first-login redirects");
    expect(compactCloseout).toContain("full segment gate");
  });
  it("routes core and department roles to their current operational homes", () => {
    const homes = { owner: "/owner", admin: "/qrm", manager: "/qrm", rep: "/sales/today", parts_counter: "/parts/companion/queue", service_writer: "/service", technician: "/m/service", dispatch: "/service", finance_admin: "/service/metrics", rental: "/qrm/rentals", rentals: "/qrm/rentals" };
    for (const [role, home] of Object.entries(homes)) expect(resolveHomeRoute(role)).toBe(home);
    expect(resolveHomeRoute("owner", "iron_owner", "stakeholder")).toBe("/brief");
    expect(resolveHomeRoute("unknown")).not.toBe("/dashboard");
  });
  it("admits supported service/parts homes without granting management authority", () => {
    for (const role of ["service_writer", "technician", "dispatch"]) expect(canAccessServiceOperations(role)).toBe(true);
    expect(canAccessPartsOperations("parts_counter")).toBe(true);
    expect(canAccessQrmSurface("rep")).toBe(false);
    expect(canAccessManagerAdminRoute("rep", "admin_duplicates")).toBe(false);
    expect(canAccessQrmSurface("manager")).toBe(true);
  });
  it("preserves Iron Man support work without enabling the manager Floor for advisors", () => {
    expect(resolveHomeRoute("rep", "iron_man")).toBe("/floor");
    expect(resolveHomeRoute("rep", null, "internal", false, true)).toBe("/floor");
    expect(canAccessFloorSurface("rep", "iron_man")).toBe(true);
    expect(canAccessFloorSurface("rep", null, true)).toBe(true);
    expect(canAccessFloorSurface("rep", "iron_advisor")).toBe(false);
  });
  it("connects App home and operations guards to the tested shared policy", () => {
    expect(appSource).toContain('path="/dashboard"');
    expect(appSource).toContain('<Navigate to={homeRoute} replace />');
    expect(appSource).toContain("canAccessServiceOperations(profile.role)");
    expect(appSource).toContain("canAccessPartsOperations(profile.role)");
    expect(appSource).toContain("canAccessFloorSurface(profile.role, profile.iron_role, profile.is_support)");
  });
});
