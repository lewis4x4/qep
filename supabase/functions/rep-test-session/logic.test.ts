import { assertEquals } from "jsr:@std/assert@1";
import {
  buildRepTestSessionRedirectTo,
  canOpenRepTestSession,
  pickWorkspaceRep,
  resolveRepTestSessionOrigin,
} from "./logic.ts";

Deno.test("canOpenRepTestSession allows manager/owner only", () => {
  assertEquals(canOpenRepTestSession("manager"), true);
  assertEquals(canOpenRepTestSession("owner"), true);
  assertEquals(canOpenRepTestSession("admin"), false);
  assertEquals(canOpenRepTestSession("rep"), false);
});

Deno.test("resolveRepTestSessionOrigin prefers APP_URL then PUBLIC_APP_URL then SITE_URL", () => {
  assertEquals(
    resolveRepTestSessionOrigin({
      APP_URL: "https://app.example.com/login",
      PUBLIC_APP_URL: "https://public.example.com",
      SITE_URL: "https://site.example.com",
    }),
    "https://app.example.com",
  );
  assertEquals(
    resolveRepTestSessionOrigin({
      PUBLIC_APP_URL: "https://public.example.com/path",
      SITE_URL: "https://site.example.com",
    }),
    "https://public.example.com",
  );
  assertEquals(
    resolveRepTestSessionOrigin({
      SITE_URL: "https://site.example.com/any",
    }),
    "https://site.example.com",
  );
});

Deno.test("buildRepTestSessionRedirectTo builds rep route and falls back safely", () => {
  assertEquals(
    buildRepTestSessionRedirectTo({ APP_URL: "https://qep.example.com" }),
    "https://qep.example.com/sales/today",
  );
  assertEquals(
    buildRepTestSessionRedirectTo({ APP_URL: "not-a-url" }),
    "https://qualityequipmentparts.netlify.app/sales/today",
  );
});

Deno.test("pickWorkspaceRep enforces rep role, active workspace, and email", () => {
  assertEquals(
    pickWorkspaceRep(
      [
        { id: "a", role: "rep", email: null, active_workspace_id: "workspace-a" },
        { id: "b", role: "admin", email: "admin@example.com", active_workspace_id: "workspace-a" },
        { id: "c", role: "rep", email: "rep@example.com", active_workspace_id: "workspace-b" },
        { id: "d", role: "rep", email: " rep2@example.com ", active_workspace_id: "workspace-a" },
      ],
      "workspace-a",
    ),
    { id: "d", email: "rep2@example.com" },
  );
});

Deno.test("pickWorkspaceRep does not false-miss when many blank-email reps precede a valid rep", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: `blank-${index + 1}`,
    role: "rep",
    email: "   ",
    active_workspace_id: "workspace-a",
  }));
  rows.push({
    id: "valid-rep",
    role: "rep",
    email: "rep-valid@example.com",
    active_workspace_id: "workspace-a",
  });

  assertEquals(
    pickWorkspaceRep(rows, "workspace-a"),
    { id: "valid-rep", email: "rep-valid@example.com" },
  );
});
