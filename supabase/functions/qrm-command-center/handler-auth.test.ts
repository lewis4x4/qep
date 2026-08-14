/**
 * QRM Command Center — team-scope authorization regression tests.
 *
 *   deno test supabase/functions/qrm-command-center/handler-auth.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { isTeamScopeAllowed } from "../_shared/qrm-command-center/ranking.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("handler uses validateUserToken (not supabase-js local JWT verifier)", () => {
  assertStringIncludes(source, "validateUserToken(authHeader)");
  assert(!source.includes(".auth.getUser("));
});

Deno.test("handler gates team scope via isTeamScopeAllowed(profileRole, blend)", () => {
  assertStringIncludes(source, "isTeamScopeAllowed(profileRole, effectiveBlend)");
  assertStringIncludes(source, "safeJsonError(");
});

Deno.test("authorized: Deal Desk admin with iron_woman blend may use team scope", () => {
  assertEquals(
    isTeamScopeAllowed("admin", [{ role: "iron_woman", weight: 1.0 }]),
    true,
  );
});

Deno.test("unauthorized: rep with iron_advisor blend cannot use team scope", () => {
  assertEquals(
    isTeamScopeAllowed("rep", [{ role: "iron_advisor", weight: 1.0 }]),
    false,
  );
});

Deno.test("unauthorized: rep with iron_woman blend cannot widen to team scope", () => {
  assertEquals(
    isTeamScopeAllowed("rep", [{ role: "iron_woman", weight: 1.0 }]),
    false,
  );
});
