import { assertEquals } from "@std/assert@1";
import {
  buildVoiceTaskCandidates,
  intentToRoutingContentType,
} from "./task-routing.ts";

Deno.test("buildVoiceTaskCandidates converts suggestion with 'tomorrow' into tomorrow due date", () => {
  const now = new Date("2026-05-19T12:00:00.000Z");
  const tasks = buildVoiceTaskCandidates({
    followUpSuggestions: ["Follow up tomorrow with final pricing"],
    now,
  });

  assertEquals(tasks.length, 1);
  assertEquals(tasks[0].scheduledFor, "2026-05-20");
  assertEquals(tasks[0].intent, "quote");
});

Deno.test("buildVoiceTaskCandidates classifies COI and parts commitments for queue routing", () => {
  const tasks = buildVoiceTaskCandidates({
    followUpSuggestions: [
      "Send COI and insurance certificate to customer",
      "Order parts for the excavator this week",
    ],
    now: new Date("2026-05-19T12:00:00.000Z"),
  });

  assertEquals(tasks.map((task) => task.intent), ["coi_admin", "parts"]);
  assertEquals(
    intentToRoutingContentType(tasks[0].intent),
    "process_improvement",
  );
  assertEquals(intentToRoutingContentType(tasks[1].intent), "parts");
});

Deno.test("buildVoiceTaskCandidates keeps explicit future tasks and dedupes repeated suggestions", () => {
  const tasks = buildVoiceTaskCandidates({
    futureTasks: [
      {
        title: "Call customer in August",
        description: "Confirm budget timing",
        scheduled_for: "2026-08-05",
      },
    ],
    followUpSuggestions: [
      "Call customer in August",
      "Call customer in August",
    ],
    now: new Date("2026-05-19T12:00:00.000Z"),
  });

  assertEquals(tasks.length, 2);
  assertEquals(tasks[0].scheduledFor, "2026-08-05");
  assertEquals(tasks[0].intent, "follow_up");
});
