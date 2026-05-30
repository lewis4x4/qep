import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  calculateQuotedTimeOverrun,
  normalizeH5PhotoCategory,
  normalizeH5PhotoPhase,
  validateH5LaborStory,
} from "./service-h5-execution.ts";

const COMPLETE_STORY = {
  labor_story:
    "Verified the customer complaint, tested hydraulics, isolated the failed hose, replaced parts, and confirmed operation under load.",
  labor_story_complaint_verification:
    "Confirmed hydraulic leak at boom circuit during visual inspection.",
  labor_story_diagnostic_steps:
    "Cleaned area, cycled function, pressure-tested circuit, and inspected fittings.",
  labor_story_root_cause:
    "Boom hose outer jacket failed and leaked under operating pressure.",
  labor_story_parts_used:
    "One OEM boom hose, two O-rings, and four quarts hydraulic oil.",
  labor_story_work_performed:
    "Replaced hose and seals, topped fluid, cleaned area, and verified no leak.",
};

Deno.test("H5 labor story requires all owner-quality story components", () => {
  const incomplete = validateH5LaborStory({
    labor_story: "Replaced hose.",
    labor_story_root_cause: "Bad hose.",
  });

  assertEquals(incomplete.ok, false);
  assert(incomplete.missing.includes("labor_story"));
  assert(incomplete.missing.includes("labor_story_complaint_verification"));
  assert(incomplete.missing.includes("labor_story_diagnostic_steps"));
  assert(incomplete.missing.includes("labor_story_parts_used"));
  assert(incomplete.missing.includes("labor_story_work_performed"));

  const complete = validateH5LaborStory(COMPLETE_STORY);
  assertEquals(complete.ok, true);
  assertEquals(complete.missing, []);
});

Deno.test("H5 quoted-time alert allows at-threshold and flags greater-than-threshold overruns", () => {
  const within = calculateQuotedTimeOverrun({
    quotedLaborHours: 10,
    actualHours: 11,
    thresholdPct: 10,
  });
  assertEquals(within.status, "within_budget");
  assertEquals(within.thresholdHours, 11);

  const over = calculateQuotedTimeOverrun({
    quotedLaborHours: 10,
    actualHours: 11.01,
    thresholdPct: 10,
  });
  assertEquals(over.status, "overrun_unacknowledged");
  assertEquals(over.overrunHours, 1.01);
  assertEquals(over.overrunPct, 10.1);
});

Deno.test("H5 quoted-time alert falls back to estimated hours and records acknowledgements", () => {
  const result = calculateQuotedTimeOverrun({
    estimatedHours: "4",
    actualHours: "5",
    acknowledgedAt: "2026-05-30T12:00:00.000Z",
  });

  assertEquals(result.status, "overrun_acknowledged");
  assertEquals(result.budgetHours, 4);
  assertEquals(result.thresholdPct, 10);
  assertEquals(result.thresholdHours, 4.4);
});

Deno.test("H5 photo normalization accepts only before/during/after phases and known categories", () => {
  assertEquals(normalizeH5PhotoPhase(" BEFORE "), "before");
  assertEquals(normalizeH5PhotoPhase("during"), "during");
  assertEquals(normalizeH5PhotoPhase("after"), "after");
  assertEquals(normalizeH5PhotoPhase("final"), null);

  assertEquals(normalizeH5PhotoCategory("Hour Meter"), "hour_meter");
  assertEquals(normalizeH5PhotoCategory("fault-codes"), "fault_codes");
  assertEquals(normalizeH5PhotoCategory("random angle"), "other");
});
