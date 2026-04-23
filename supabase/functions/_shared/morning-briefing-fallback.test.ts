import { assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildFallbackMorningBriefing,
  type MorningBriefingData,
} from "./morning-briefing-fallback.ts";

const sample: MorningBriefingData = {
  userId: "user-1",
  fullName: "Brian Lewis",
  role: "owner",
  pipelineTotal: 4864000,
  openDealCount: 19,
  newVoiceNotes: 2,
  dealsClosingSoon: [
    {
      name: "Bandit Chipper Demo",
      amount: 420000,
      expected_close: "2026-04-24",
      stage: "Negotiation",
      company: "Apex Timber",
    },
  ],
  overdueFollowUps: [
    {
      name: "Mulcher Follow-up",
      amount: 185000,
      follow_up_date: "2026-04-20T15:00:00Z",
      company: "Lake City Branch",
    },
  ],
  recentActivities: [
    {
      type: "call",
      body: "Reviewed quote timing and financing options.",
      date: "2026-04-22T12:00:00Z",
    },
  ],
};

Deno.test("buildFallbackMorningBriefing returns the expected sections", () => {
  const briefing = buildFallbackMorningBriefing(sample, new Date("2026-04-23T09:00:00Z"));

  assertStringIncludes(briefing, "# Good morning, Brian");
  assertStringIncludes(briefing, "## Pipeline Snapshot");
  assertStringIncludes(briefing, "## Priority Actions");
  assertStringIncludes(briefing, "## Deals to Watch");
  assertStringIncludes(briefing, "## Quick Wins");
  assertStringIncludes(briefing, "Bandit Chipper Demo");
  assertStringIncludes(briefing, "Mulcher Follow-up");
});
