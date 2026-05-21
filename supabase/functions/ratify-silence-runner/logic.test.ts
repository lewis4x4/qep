import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRatifySilenceRationale,
  isRatifySilenceEligible,
  resolveSilenceThresholdDays,
  stampRatifySilencePacket,
  type DecisionCandidate,
} from "./logic.ts";

function makeDecision(overrides: Partial<DecisionCandidate> = {}): DecisionCandidate {
  return {
    id: "d1",
    code: "Q11",
    lane: "ratify",
    status: "open",
    owner_role: "owner",
    created_at: "2026-05-01T00:00:00.000Z",
    silence_threshold_days: 7,
    recommended_option: "Proceed",
    ai_prep_packet: {},
    ...overrides,
  };
}

Deno.test("eligible when RATIFY open decision exceeds default 7-day threshold", () => {
  const decision = makeDecision({ silence_threshold_days: null });
  const eligible = isRatifySilenceEligible({ decision, now: new Date("2026-05-10T00:00:00.000Z") });
  assertEquals(eligible, true);
});

Deno.test("not eligible when lane is not ratify", () => {
  const decision = makeDecision({ lane: "auto" });
  const eligible = isRatifySilenceEligible({ decision, now: new Date("2026-05-20T00:00:00.000Z") });
  assertEquals(eligible, false);
});

Deno.test("not eligible when recommended option is missing", () => {
  const decision = makeDecision({ recommended_option: "  " });
  const eligible = isRatifySilenceEligible({ decision, now: new Date("2026-05-20T00:00:00.000Z") });
  assertEquals(eligible, false);
});

Deno.test("threshold clamps to at least 1 day", () => {
  assertEquals(resolveSilenceThresholdDays(0), 1);
  assertEquals(resolveSilenceThresholdDays(-10), 1);
});

Deno.test("packet stamp preserves existing keys", () => {
  const stamped = stampRatifySilencePacket(
    { keep: true },
    {
      ran_at: "2026-05-21T00:00:00.000Z",
      actor: "runner",
      threshold_days: 7,
      notification_attempts: [],
    },
  );

  assertEquals(stamped.keep, true);
  assertEquals(typeof stamped.ratify_silence_last_run, "object");
});

Deno.test("rationale includes RATIFY silence detail", () => {
  const rationale = buildRatifySilenceRationale({
    decisionCode: "Q11",
    thresholdDays: 7,
    actor: "ratify-silence-runner",
  });

  assertEquals(rationale.includes("RATIFY silence auto-promotion"), true);
  assertEquals(rationale.includes("Q11"), true);
});
