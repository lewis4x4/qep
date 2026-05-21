import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSignedDecisionActionLink,
  signDecisionMagicPayload,
  verifyDecisionMagicToken,
} from "./decision-magic-link.ts";

Deno.test("decision magic token signs and verifies", async () => {
  const token = await signDecisionMagicPayload({
    decision_id: "dec-123",
    decision_code: "QEP-159",
    action: "approve",
    owner_role: "brian",
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: "nonce-1",
  }, "secret");

  const payload = await verifyDecisionMagicToken(token, "secret");
  assertEquals(payload.action, "approve");
  assertEquals(payload.owner_role, "brian");
  assertEquals(payload.decision_code, "QEP-159");
});

Deno.test("decision magic token rejects tampering", async () => {
  const token = await signDecisionMagicPayload({
    decision_id: "dec-123",
    action: "block",
    owner_role: "ryan",
    exp: Math.floor(Date.now() / 1000) + 600,
  }, "secret");

  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  await assertRejects(() => verifyDecisionMagicToken(tampered, "secret"), Error, "Invalid decision magic token signature");
});

Deno.test("decision magic token rejects expired payload", async () => {
  const token = await signDecisionMagicPayload({
    decision_code: "QEP-159",
    action: "need_info",
    owner_role: "angela",
    exp: Math.floor(Date.now() / 1000) - 1,
  }, "secret");

  await assertRejects(() => verifyDecisionMagicToken(token, "secret"), Error, "Decision magic token expired");
});

Deno.test("buildSignedDecisionActionLink includes token query param", async () => {
  const result = await buildSignedDecisionActionLink(
    "https://example.com/magic",
    {
      decision_code: "QEP-159",
      action: "approve",
      owner_role: "brian",
      nonce: "n1",
    },
    "secret",
    900,
  );

  assertEquals(result.url.startsWith("https://example.com/magic?token="), true);
  const payload = await verifyDecisionMagicToken(result.token, "secret");
  assertEquals(payload.action, "approve");
});
