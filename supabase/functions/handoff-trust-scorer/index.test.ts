import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import {
  assessDealOutcome,
  buildHandoffEvidence,
  countSubjectActivities,
  findFirstSubjectActivity,
  scoreRecipientReadiness,
} from "./scoring.ts";

Deno.test("countSubjectActivities only counts activities on the handed-off deal", () => {
  assertEquals(
    countSubjectActivities(
      [
        { created_at: "2026-04-10T10:00:00Z", deal_id: "deal-1", activity_type: "note" },
        { created_at: "2026-04-10T11:00:00Z", deal_id: "deal-2", activity_type: "call" },
        { created_at: "2026-04-10T12:00:00Z", deal_id: "deal-1", activity_type: "email" },
      ],
      "deal-1",
    ),
    2,
  );
});

Deno.test("findFirstSubjectActivity uses the first recipient action on the same deal only", () => {
  const first = findFirstSubjectActivity(
    [
      { created_at: "2026-04-10T13:00:00Z", deal_id: "deal-2", activity_type: "note" },
      { created_at: "2026-04-10T14:30:00Z", deal_id: "deal-1", activity_type: "call" },
      { created_at: "2026-04-10T14:00:00Z", deal_id: "deal-1", activity_type: "email" },
    ],
    "deal-1",
  );

  assertEquals(first?.created_at, "2026-04-10T14:00:00Z");
  assertEquals(first?.activity_type, "email");
});

Deno.test("buildHandoffEvidence captures first-action timing for seam review", () => {
  const evidence = buildHandoffEvidence({
    senderActivityCount: 2,
    firstAction: {
      created_at: "2026-04-10T14:00:00Z",
      deal_id: "deal-1",
      activity_type: "email",
    },
    handoffAt: "2026-04-10T10:00:00Z",
  });

  assertEquals(evidence.sender_activity_count, 2);
  assertEquals(evidence.first_action_type, "email");
  assertEquals(evidence.hours_to_first_action, 4);
  assertEquals(scoreRecipientReadiness(evidence.hours_to_first_action), 1);
});

Deno.test("assessDealOutcome fails soft when the deal does not resolve to progress or closure", () => {
  assertEquals(
    assessDealOutcome({
      transitionCount: 0,
      isClosedWon: false,
      isClosedLost: false,
    }),
    "unknown",
  );
});
