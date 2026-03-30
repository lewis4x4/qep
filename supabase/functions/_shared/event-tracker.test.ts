import { assertEquals } from "jsr:@std/assert@1";
import { emitIntegrationConfigUpdated } from "./event-tracker.ts";

Deno.test("emitIntegrationConfigUpdated forwards status and auth properties", async () => {
  const calls: Array<Record<string, unknown>> = [];

  const tracker = {
    async trackEvent(input: Record<string, unknown>) {
      calls.push(input);
    },
  };

  await emitIntegrationConfigUpdated(
    tracker as unknown as Parameters<typeof emitIntegrationConfigUpdated>[0],
    {
      integration: "hubspot",
      changedFields: ["credentials", "endpoint_url"],
      updatedByRole: "owner",
      statusAfter: "pending_credentials",
      authType: "oauth2",
      userId: "7b57ed2a-5bb2-41c5-80ca-aac73e818327",
      requestId: "req_123",
    },
  );

  assertEquals(calls.length, 1);
  const payload = calls[0];
  assertEquals(payload.event_name, "integration_credentials_saved");
  assertEquals(payload.entity_id, "hubspot");

  const properties = payload.properties as Record<string, unknown>;
  assertEquals(properties.status_after, "pending_credentials");
  assertEquals(properties.auth_type, "oauth2");
  assertEquals(properties.integration_key, "hubspot");
  assertEquals(properties.changed_fields, ["credentials", "endpoint_url"]);
});
