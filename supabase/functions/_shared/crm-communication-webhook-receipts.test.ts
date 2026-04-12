import { assertEquals } from "jsr:@std/assert@1";
import {
  claimCommunicationWebhookReceipt,
  completeCommunicationWebhookReceipt,
} from "./crm-communication-webhook-receipts.ts";

function createFakeAdmin() {
  const rows = new Map<string, { id: string; processed_at: string | null }>();
  let lastUpsert: Record<string, unknown> | null = null;
  let pendingUpdateId: string | null = null;

  return {
    client: {
      from() {
        return {
          upsert(payload: Record<string, unknown>) {
            lastUpsert = payload;
            const key = `${payload.workspace_id}:${payload.provider}:${payload.event_id}`;
            const existing = rows.get(key) ?? { id: crypto.randomUUID(), processed_at: null };
            rows.set(key, existing);
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: existing, error: null });
                  },
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(_column: string, value: string) {
                pendingUpdateId = value;
                for (const row of rows.values()) {
                  if (row.id === pendingUpdateId) {
                    row.processed_at = String(payload.processed_at ?? null);
                  }
                }
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    },
    rows,
    getLastUpsert: () => lastUpsert,
  };
}

Deno.test("claimCommunicationWebhookReceipt uses workspace/provider/event uniqueness", async () => {
  const fake = createFakeAdmin();
  const receipt = await claimCommunicationWebhookReceipt({
    admin: fake.client as never,
    workspaceId: "default",
    provider: "twilio",
    eventId: "SM123:delivered",
    payloadHash: "abc",
    routeBindingKey: "AC123:+13865550000",
  });

  assertEquals(typeof receipt.id, "string");
  assertEquals(receipt.alreadyProcessed, false);
  assertEquals(fake.getLastUpsert()?.workspace_id, "default");
});

Deno.test("completeCommunicationWebhookReceipt marks receipt processed", async () => {
  const fake = createFakeAdmin();
  const receipt = await claimCommunicationWebhookReceipt({
    admin: fake.client as never,
    workspaceId: "default",
    provider: "sendgrid",
    eventId: "evt_123",
    payloadHash: "abc",
    routeBindingKey: "acct:from@example.com",
  });

  await completeCommunicationWebhookReceipt(fake.client as never, receipt.id);
  const stored = [...fake.rows.values()].find((row) => row.id === receipt.id);
  assertEquals(typeof stored?.processed_at, "string");
});
