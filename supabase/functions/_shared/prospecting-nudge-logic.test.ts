/**
 * Prospecting Nudge — pure-function tests.
 *
 * Run with: deno test supabase/functions/_shared/prospecting-nudge-logic.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNudgeNotificationBody,
  buildNudgeNotificationTitle,
  computeProspectingNudges,
} from "./prospecting-nudge-logic.ts";

Deno.test("empty reps or empty managers yields no decisions", () => {
  assertEquals(
    computeProspectingNudges({ workspace_id: "ws", reps: [], managers: [{ user_id: "m1" }] }),
    [],
  );
  assertEquals(
    computeProspectingNudges({
      workspace_id: "ws",
      reps: [{ rep_id: "r1", rep_name: "Rep", positive_visits: 0, target: 10 }],
      managers: [],
    }),
    [],
  );
});

Deno.test("skips reps with target = 0 (not on quota)", () => {
  const out = computeProspectingNudges({
    workspace_id: "ws",
    reps: [{ rep_id: "r1", rep_name: "Off Quota", positive_visits: 0, target: 0 }],
    managers: [{ user_id: "m1" }],
  });
  assertEquals(out.length, 0);
});

Deno.test("skips reps at or above target", () => {
  const out = computeProspectingNudges({
    workspace_id: "ws",
    reps: [
      { rep_id: "r1", rep_name: "On Target", positive_visits: 10, target: 10 },
      { rep_id: "r2", rep_name: "Above", positive_visits: 12, target: 10 },
    ],
    managers: [{ user_id: "m1" }],
  });
  assertEquals(out.length, 0);
});

Deno.test("flags critical when at or below 50% completion", () => {
  const out = computeProspectingNudges({
    workspace_id: "ws",
    reps: [{ rep_id: "r1", rep_name: "Low", positive_visits: 3, target: 10 }],
    managers: [{ user_id: "m1" }],
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].severity, "critical");
  assertEquals(out[0].short_by, 7);
});

Deno.test("flags warning when above 50% but below target", () => {
  const out = computeProspectingNudges({
    workspace_id: "ws",
    reps: [{ rep_id: "r1", rep_name: "Close", positive_visits: 8, target: 10 }],
    managers: [{ user_id: "m1" }],
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].severity, "warning");
  assertEquals(out[0].short_by, 2);
});

Deno.test("fans out one decision per manager per under-target rep", () => {
  const out = computeProspectingNudges({
    workspace_id: "ws",
    reps: [
      { rep_id: "r1", rep_name: "Rep One", positive_visits: 3, target: 10 },
      { rep_id: "r2", rep_name: "Rep Two", positive_visits: 0, target: 10 },
    ],
    managers: [{ user_id: "m1" }, { user_id: "m2" }],
  });
  assertEquals(out.length, 4);
  const pairs = new Set(out.map((d) => `${d.manager_user_id}:${d.rep_id}`));
  assertEquals(pairs.size, 4);
});

Deno.test("critical threshold is configurable", () => {
  const out = computeProspectingNudges({
    workspace_id: "ws",
    reps: [{ rep_id: "r1", rep_name: "X", positive_visits: 5, target: 10 }],
    managers: [{ user_id: "m1" }],
    critical_threshold: 0.75,
  });
  // 0.5 completion ≤ 0.75 threshold → critical
  assertEquals(out[0].severity, "critical");
});

Deno.test("notification copy includes rep name + counts", () => {
  const decision = {
    workspace_id: "ws",
    manager_user_id: "m1",
    rep_id: "r1",
    rep_name: "Alex",
    positive_visits: 3,
    target: 10,
    short_by: 7,
    severity: "critical" as const,
  };
  const title = buildNudgeNotificationTitle(decision);
  const body = buildNudgeNotificationBody(decision);
  // Title contains name, short-by, and severity marker
  assertEquals(title.includes("Alex"), true);
  assertEquals(title.includes("7"), true);
  assertEquals(title.includes("critical"), true);
  // Body contains the progress fraction
  assertEquals(body.includes("3 of 10"), true);
});

Deno.test("null rep name falls back to a generic label", () => {
  const decision = {
    workspace_id: "ws",
    manager_user_id: "m1",
    rep_id: "r1",
    rep_name: null,
    positive_visits: 2,
    target: 8,
    short_by: 6,
    severity: "warning" as const,
  };
  const title = buildNudgeNotificationTitle(decision);
  assertEquals(title.startsWith("A rep"), true);
});
