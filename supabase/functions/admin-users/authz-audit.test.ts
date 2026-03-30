import { assertEquals } from "jsr:@std/assert@1";
import { emitAuthzDenialAuditEvent } from "./authz-audit.ts";

Deno.test("emitAuthzDenialAuditEvent emits structured missing-auth denial log", () => {
  const calls: Array<{ message: string; payload: unknown }> = [];

  const event = emitAuthzDenialAuditEvent(
    {
      route: "/functions/v1/admin-users",
      action: null,
      reasonCode: "missing_authorization_header",
      status: 401,
    },
    (message, payload) => {
      calls.push({ message, payload });
    },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.message, "[admin-users][authz-deny]");
  assertEquals(event.route, "/functions/v1/admin-users");
  assertEquals(event.action, "unknown");
  assertEquals(event.callerUserId, null);
  assertEquals(event.reasonCode, "missing_authorization_header");
  assertEquals(event.status, 401);
});

Deno.test("emitAuthzDenialAuditEvent emits insufficient-role denial log with caller id", () => {
  const calls: Array<{ message: string; payload: unknown }> = [];

  const event = emitAuthzDenialAuditEvent(
    {
      route: "/functions/v1/admin-users",
      action: "update_integration",
      callerUserId: "77fb27a5-56e8-463a-a159-e04dfe754ef8",
      reasonCode: "insufficient_manage_users_role",
      status: 403,
    },
    (message, payload) => {
      calls.push({ message, payload });
    },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.message, "[admin-users][authz-deny]");
  assertEquals(event.route, "/functions/v1/admin-users");
  assertEquals(event.action, "update_integration");
  assertEquals(event.callerUserId, "77fb27a5-56e8-463a-a159-e04dfe754ef8");
  assertEquals(event.reasonCode, "insufficient_manage_users_role");
  assertEquals(event.status, 403);
});
