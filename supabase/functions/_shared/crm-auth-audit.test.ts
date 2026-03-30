import { assertEquals } from "jsr:@std/assert@1";
import {
  emitCrmAccessDeniedAudit,
  logCrmAuthEvent,
  type CrmAuditClient,
} from "./crm-auth-audit.ts";

class MockAuditClient {
  calls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  async rpc(fn: string, args: Record<string, unknown> = {}) {
    this.calls.push({ fn, args });
    return { error: null };
  }
}

Deno.test("logCrmAuthEvent strips secret metadata keys before RPC", async () => {
  const client = new MockAuditClient();

  await logCrmAuthEvent(client as unknown as CrmAuditClient, {
    workspaceId: "default",
    eventType: "access_denied",
    outcome: "failure",
    requestId: "req-1",
    resource: "/functions/v1/crm-hubspot-import",
    metadata: {
      safe: "ok",
      token: "should-be-removed",
      nested: {
        refresh_token: "remove-this",
        keep: true,
      },
    },
  });

  assertEquals(client.calls.length, 1);
  assertEquals(client.calls[0]?.fn, "log_crm_auth_event");
  const metadata = client.calls[0]?.args.p_metadata as Record<string, unknown>;
  assertEquals(metadata.safe, "ok");
  assertEquals(metadata.token, undefined);
  assertEquals(
    (metadata.nested as Record<string, unknown>).refresh_token,
    undefined,
  );
  assertEquals((metadata.nested as Record<string, unknown>).keep, true);
});

Deno.test("emitCrmAccessDeniedAudit writes access_denied failure event", async () => {
  const client = new MockAuditClient();

  await emitCrmAccessDeniedAudit(client as unknown as CrmAuditClient, {
    workspaceId: "default",
    requestId: "req-2",
    resource: "/functions/v1/hubspot-webhook",
    reasonCode: "invalid_signature",
    actorUserId: "user-1",
  });

  assertEquals(client.calls.length, 1);
  const args = client.calls[0]?.args;
  assertEquals(args.p_event_type, "access_denied");
  assertEquals(args.p_outcome, "failure");
  assertEquals(args.p_actor_user_id, "user-1");
  assertEquals(args.p_resource, "/functions/v1/hubspot-webhook");
  assertEquals(
    (args.p_metadata as Record<string, unknown>).reason_code,
    "invalid_signature",
  );
});
