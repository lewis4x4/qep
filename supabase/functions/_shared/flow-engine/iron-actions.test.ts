import { assertEquals } from "jsr:@std/assert@1";
import { IRON_ACTION_REGISTRY, parseIronFollowUpAt } from "./iron-actions.ts";

Deno.test("Iron follow-up date parser handles operator shorthand", () => {
  const now = new Date("2026-05-13T16:00:00.000Z"); // Wednesday

  assertEquals(
    parseIronFollowUpAt("tomorrow", now),
    "2026-05-14T14:00:00.000Z",
  );
  assertEquals(
    parseIronFollowUpAt("next Tuesday", now),
    "2026-05-19T14:00:00.000Z",
  );
  assertEquals(
    parseIronFollowUpAt("in 3 days at 2:30pm", now),
    "2026-05-16T14:30:00.000Z",
  );
});

Deno.test("Iron follow-up action is registered", () => {
  assertEquals(Boolean(IRON_ACTION_REGISTRY.iron_schedule_follow_up), true);
  assertEquals(
    IRON_ACTION_REGISTRY.iron_schedule_follow_up.affects_modules.includes(
      "qrm",
    ),
    true,
  );
});
