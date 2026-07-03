import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "737_b57_role_scoped_home_route_closeout.sql");
const homeRoute = readText("apps", "web", "src", "lib", "home-route.ts");
const homeRouteTest = readText("apps", "web", "src", "lib", "home-route.test.ts");
const appRoutingTest = readText("apps", "web", "src", "lib", "home-route-app-routing.test.ts");
const appSource = readText("apps", "web", "src", "App.tsx");
const roleHomeAudit = readText("docs", "role-home-feature-audit.md");

const compactCloseout = compact(closeoutSql);
const compactHomeRoute = compact(homeRoute);
const compactHomeRouteTest = compact(homeRouteTest);
const compactAppRoutingTest = compact(appRoutingTest);
const compactAppSource = compact(appSource);
const compactRoleHomeAudit = compact(roleHomeAudit);

describe("737_b57_role_scoped_home_route_closeout.sql contract", () => {
  it("marks only B5.7 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b5.7'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("role-appropriate operational command centers");
    expect(compactCloseout).not.toContain("where task_id = 'b5.6'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.8'");
  });

  it("keeps manual and database-apply boundaries explicit", () => {
    expect(compactCloseout).toContain("no credentialed browser uat");
    expect(compactCloseout).toContain("first-login redirects");
    expect(compactCloseout).toContain("full segment gate");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("centralizes role-scoped home targets in resolveHomeRoute", () => {
    expect(compactHomeRoute).toContain("if (audience === \"stakeholder\")");
    expect(compactHomeRoute).toContain("case \"owner\": return \"/owner\"");
    expect(compactHomeRoute).toContain("case \"admin\": case \"manager\": return \"/qrm\"");
    expect(compactHomeRoute).toContain("case \"parts\": return \"/parts/companion/queue\"");
    expect(compactHomeRoute).toContain("case \"service\": return \"/service\"");
    expect(compactHomeRoute).toContain("case \"rental\": case \"rentals\": return \"/rentals\"");
    expect(compactHomeRoute).toContain("case \"rep\": return \"/sales/today\"");
    expect(compactHomeRoute).toContain("if (floormode || isfloorironrole(ironrole))");
    expect(compactHomeRoute).toContain("return \"/dashboard\"");
  });

  it("keeps rep access out of non-sales management surfaces", () => {
    expect(compactHomeRoute).toContain("export function canaccessfloorsurface");
    expect(compactHomeRoute).toContain("return normalizerole(userrole) !== \"rep\"");
    expect(compactHomeRoute).toContain("export function canaccessqrmsurface");
    expect(compactHomeRoute).toContain("normalizedrole === \"owner\" || normalizedrole === \"admin\" || normalizedrole === \"manager\"");
    expect(compactHomeRoute).toContain("export function canaccessmanageradminroute");
    expect(compactHomeRoute).toContain("return canaccessmanageradminsurface(userrole)");
    expect(compactHomeRoute).toContain("return canaccessmanageradminroute(userrole, routekey) ? null : homeroute");
  });

  it("locks B5.7 route behavior in focused tests", () => {
    expect(compactHomeRouteTest).toContain("keeps core business roles on their role-scoped homes");
    expect(compactHomeRouteTest).toContain("resolvehomeroute(\"rep\", \"iron_advisor\")).tobe(\"/sales/today\")");
    expect(compactHomeRouteTest).toContain("resolvehomeroute(\"manager\", \"iron_parts_manager\")).tobe(\"/qrm\")");
    expect(compactHomeRouteTest).toContain("rep cannot access /floor, /qrm, or manager/admin surfaces");
    expect(compactHomeRouteTest).toContain("manager/admin route decisions redirect reps to homeroute");
    expect(compactHomeRouteTest).toContain("resolvemanageradminrouteredirect(\"rep\", rephome, \"admin_duplicates\")");
  });

  it("locks App route wiring to homeRoute redirects", () => {
    expect(compactAppRoutingTest).toContain("sc-2 app routing policy via centralized home-route helpers");
    expect(compactAppRoutingTest).toContain("rep route policy resolves guarded surface deep-links back to homeroute");
    expect(compactAppRoutingTest).toContain("/dashboard canonical redirect target remains role-scoped homeroute");
    expect(compactAppRoutingTest).toContain("app sc-2 routes reference centralized helpers and homeroute redirects");
    expect(compactAppSource).toContain("<route path=\"/\" element={<navigate to={homeroute} replace />} />");
    expect(compactAppSource).toContain("path=\"/dashboard\"");
    expect(compactAppSource).toContain("!canaccessfloorsurface(profile.role)");
    expect(compactAppSource).toContain("canaccessqrmsurface(profile.role) ? (");
    expect(compactAppSource).toContain("canaccessmanageradminroute(profile.role, \"qrm_activities_templates\")");
    expect(compactAppSource).toContain("navigate to={manageradmintemplatesredirect ?? homeroute} replace");
  });

  it("keeps the source audit aligned with the current route precedence", () => {
    expect(compactRoleHomeAudit).toContain("core business system roles resolve before any floor/iron fallback");
    expect(compactRoleHomeAudit).toContain("`rep` → `/sales/today`");
    expect(compactRoleHomeAudit).toContain("only non-core roles fall back to `/floor`");
    expect(compactRoleHomeAudit).toContain("`canaccessfloorsurface(\"rep\")` → `false`");
    expect(compactRoleHomeAudit).toContain("/floor` deep links redirect reps back to `homeroute`");
    expect(compactRoleHomeAudit).toContain("`canaccessqrmsurface(\"rep\")`");
  });
});
