import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDecisionMagicActionPatch } from "./logic.ts";

Deno.test("approve patch sets answered fields", () => {
  const patch = buildDecisionMagicActionPatch({
    action: "approve",
    ownerRole: "brian",
    recommendedOption: "ratify_with_owner",
    existingPacket: null,
    nowIso: "2026-05-21T12:00:00.000Z",
  });

  assertEquals(patch.status, "answered");
  assertEquals(patch.answered_by, "magic-link:brian");
  assertEquals(patch.answered_option, "ratify_with_owner");
});

Deno.test("block patch escalates and stamps packet", () => {
  const patch = buildDecisionMagicActionPatch({
    action: "block",
    ownerRole: "ryan",
    recommendedOption: null,
    existingPacket: { foo: "bar" },
    nowIso: "2026-05-21T12:00:00.000Z",
  });

  assertEquals(patch.status, "escalated");
  assertEquals((patch.ai_prep_packet as Record<string, unknown>).foo, "bar");
  assertEquals(((patch.ai_prep_packet as Record<string, unknown>).magic_link_last_action as Record<string, unknown>).action, "block");
});
