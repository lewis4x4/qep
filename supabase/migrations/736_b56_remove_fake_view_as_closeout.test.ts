import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "736_b56_remove_fake_view_as_closeout.sql");
const topBar = readText("apps", "web", "src", "components", "TopBar.tsx");
const viewAsRemovalTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "floor",
  "pages",
  "__tests__",
  "view-as-removal.test.ts",
);
const viewAsNoopTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "floor",
  "pages",
  "__tests__",
  "floor-view-as-noop.test.tsx",
);
const repSessionIndex = readText("supabase", "functions", "rep-test-session", "index.ts");
const repSessionLogic = readText("supabase", "functions", "rep-test-session", "logic.ts");
const repSessionLogicTest = readText("supabase", "functions", "rep-test-session", "logic.test.ts");
const supabaseConfig = readText("supabase", "config.toml");

const compactCloseout = compact(closeoutSql);
const compactTopBar = compact(topBar);
const compactViewAsRemovalTest = compact(viewAsRemovalTest);
const compactViewAsNoopTest = compact(viewAsNoopTest);
const compactRepSessionIndex = compact(repSessionIndex);
const compactRepSessionLogic = compact(repSessionLogic);
const compactRepSessionLogicTest = compact(repSessionLogicTest);
const compactSupabaseConfig = compact(supabaseConfig);

describe("736_b56_remove_fake_view_as_closeout.sql contract", () => {
  it("marks only B5.6 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b5.6'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("real supabase auth and workspace-scoped data");
    expect(compactCloseout).not.toContain("where task_id = 'b5.5'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.7'");
  });

  it("keeps live-auth and migration boundaries explicit", () => {
    expect(compactCloseout).toContain("no live manager/owner magic-link session");
    expect(compactCloseout).toContain("supabase_service_role_key");
    expect(compactCloseout).toContain("real rep email");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).toContain("does not accept a requested rep id or email");
  });

  it("exposes a manager/owner-only TopBar action that opens the edge action link", () => {
    expect(compactTopBar).toContain("const canopenreptestsession = [\"manager\", \"owner\"].includes(profile.role)");
    expect(compactTopBar).toContain("supabase.functions.invoke<{ actionlink?: string }>(\"rep-test-session\"");
    expect(compactTopBar).toContain("window.open(data.actionlink, \"_blank\", \"noopener,noreferrer\")");
    expect(compactTopBar).toContain("open rep test session");
    expect(compactTopBar).toContain("could not open rep test session. please try again.");
  });

  it("locks fake view_as query behavior out of floor role rendering", () => {
    expect(compactViewAsRemovalTest).toContain("topbar and floorpage no longer contain view_as query behavior");
    expect(compactViewAsRemovalTest).toContain("topbarsource.includes(\"view_as\")).tobe(false)");
    expect(compactViewAsRemovalTest).toContain("floorpagesource.includes(\"view_as\")).tobe(false)");
    expect(compactViewAsNoopTest).toContain("/floor?view_as=iron_advisor");
    expect(compactViewAsNoopTest).toContain("owner home");
    expect(compactViewAsNoopTest).toContain("read-only preview");
    expect(compactViewAsNoopTest).toContain("querybytext(\"read-only preview\")).tobenull()");
  });

  it("requires canonical service auth and selects a real same-workspace rep", () => {
    expect(compactRepSessionIndex).toContain("requireserviceuser(req.headers.get(\"authorization\"), origin)");
    expect(compactRepSessionIndex).toContain("!canopenreptestsession(auth.role)");
    expect(compactRepSessionIndex).toContain(".eq(\"role\", \"rep\")");
    expect(compactRepSessionIndex).toContain(".eq(\"active_workspace_id\", auth.workspaceid)");
    expect(compactRepSessionIndex).toContain(".eq(\"profile_workspaces.workspace_id\", auth.workspaceid)");
    expect(compactRepSessionIndex).toContain(".not(\"email\", \"is\", null)");
    expect(compactRepSessionIndex).toContain("pickworkspacerep(");
    expect(compactRepSessionIndex).toContain("type: \"magiclink\"");
    expect(compactRepSessionIndex).toContain("email: rep.email");
    expect(compactRepSessionIndex).toContain("role: \"rep\"");
  });

  it("centralizes rep session role, route, origin, and fallback selection rules", () => {
    expect(compactRepSessionLogic).toContain("rep_test_session_allowed_roles = new set([\"manager\", \"owner\"])");
    expect(compactRepSessionLogic).toContain("rep_test_session_route = \"/sales/today\"");
    expect(compactRepSessionLogic).toContain("resolveRepTestSessionOrigin".toLowerCase());
    expect(compactRepSessionLogic).toContain("normalizEOrigin".toLowerCase());
    expect(compactRepSessionLogic).toContain("row.role !== \"rep\"");
    expect(compactRepSessionLogic).toContain("row.active_workspace_id !== workspaceid");
    expect(compactRepSessionLogic).toContain("!row.id || !email");
  });

  it("keeps focused Deno coverage for the edge helper contract", () => {
    expect(compactRepSessionLogicTest).toContain("canopenreptestsession allows manager/owner only");
    expect(compactRepSessionLogicTest).toContain("canopenreptestsession(\"admin\"), false");
    expect(compactRepSessionLogicTest).toContain("buildreptestsessionredirectto({ app_url: \"https://qep.example.com\" })");
    expect(compactRepSessionLogicTest).toContain("https://qep.example.com/sales/today");
    expect(compactRepSessionLogicTest).toContain("pickworkspacerep enforces rep role, active workspace, and email");
    expect(compactRepSessionLogicTest).toContain("does not false-miss when many blank-email reps precede a valid rep");
  });

  it("registers the edge function for service-auth validation at the function boundary", () => {
    expect(compactSupabaseConfig).toContain("[functions.rep-test-session] verify_jwt = false");
    expect(compactCloseout).toContain("canonical service-auth validation");
  });
});
