import { assertEquals } from "jsr:@std/assert@1";
import {
  buildCommunicationWebhookDedupeKey,
  MIN_ROUTE_TOKEN_BYTES,
  routeTokenMeetsMinimumEntropy,
  verifyOpaqueRouteToken,
  WEBHOOK_VERIFICATION_ORDER,
} from "./webhook-tenant-routing.ts";

Deno.test("WEBHOOK_VERIFICATION_ORDER lists signature before tenant routing", () => {
  assertEquals(WEBHOOK_VERIFICATION_ORDER[0], "provider_signature");
  assertEquals(WEBHOOK_VERIFICATION_ORDER[1], "route_token_or_hmac");
  assertEquals(WEBHOOK_VERIFICATION_ORDER[2], "workspace_resolution");
  assertEquals(WEBHOOK_VERIFICATION_ORDER[3], "idempotency_claim");
});

Deno.test("verifyOpaqueRouteToken rejects forged token (wrong bytes)", () => {
  const expected = "wsrt_a7f3c9e2d1b8406f8e5c3a9012345678abcdef";
  assertEquals(
    verifyOpaqueRouteToken("wsrt_attacker_replaced_value_________", expected),
    false,
  );
});

Deno.test("verifyOpaqueRouteToken rejects valid-length wrong workspace token", () => {
  const tokenA = "a".repeat(48);
  const tokenB = "b".repeat(48);
  assertEquals(verifyOpaqueRouteToken(tokenA, tokenB), false);
  assertEquals(verifyOpaqueRouteToken(tokenA, tokenA), true);
});

Deno.test("buildCommunicationWebhookDedupeKey matches replayed event id", () => {
  const k1 = buildCommunicationWebhookDedupeKey(
    "ws_1",
    "sendgrid",
    "evt_123",
  );
  const k2 = buildCommunicationWebhookDedupeKey(
    "ws_1",
    "sendgrid",
    "evt_123",
  );
  assertEquals(k1, k2);
  assertEquals(k1, "ws_1:sendgrid:evt_123");
});

Deno.test("buildCommunicationWebhookDedupeKey separates distinct event ids (no replay collision)", () => {
  const kReplay = buildCommunicationWebhookDedupeKey(
    "ws_1",
    "sendgrid",
    "evt_123",
  );
  const kNew = buildCommunicationWebhookDedupeKey("ws_1", "sendgrid", "evt_124");
  assertEquals(kReplay !== kNew, true);
});

Deno.test("routeTokenMeetsMinimumEntropy rejects short tokens", () => {
  assertEquals(routeTokenMeetsMinimumEntropy("short"), false);
  assertEquals(
    routeTokenMeetsMinimumEntropy("a".repeat(MIN_ROUTE_TOKEN_BYTES)),
    true,
  );
});
