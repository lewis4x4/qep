/**
 * Proposal Urgency tests — Slice 20t.
 *
 * The urgency classifier decides how loudly the scorer-evolution
 * proposal speaks to the manager. If it escalates when it shouldn't,
 * a manager churns a PR they didn't need to write. If it de-escalates
 * when it should be shouting, the scorer rot goes unflagged. Every
 * branch of the decision tree + every copy string gets pinned here.
 */

import { describe, expect, test } from "bun:test";
import {
  computeProposalUrgency,
  describeProposalUrgencyPill,
  HIGH_URGENCY_ACCURACY_DROP,
} from "../proposal-urgency";
import type { CalibrationDriftReport } from "../calibration-drift";

function drift(overrides: Partial<CalibrationDriftReport>): CalibrationDriftReport {
  return {
    referenceDate: "2026-01-01T00:00:00.000Z",
    windowDays: 90,
    recentN: 20,
    priorN: 30,
    recentAccuracy: 0.7,
    priorAccuracy: 0.65,
    accuracyDelta: 0.05,
    recentBrier: 0.2,
    priorBrier: 0.22,
    brierDelta: -0.02,
    direction: "stable",
    lowConfidence: false,
    ...overrides,
  };
}

describe("computeProposalUrgency — constants", () => {
  test("exports the escalation threshold", () => {
    expect(HIGH_URGENCY_ACCURACY_DROP).toBeCloseTo(0.08, 10);
  });
});

describe("computeProposalUrgency — null / empty drift", () => {
  test("null drift → medium, no rationale", () => {
    const r = computeProposalUrgency(null);
    expect(r.urgency).toBe("medium");
    expect(r.rationale).toBeNull();
  });

  test("zero-data drift → medium, no rationale", () => {
    const r = computeProposalUrgency(
      drift({ recentN: 0, priorN: 0, accuracyDelta: null, brierDelta: null, direction: "stable", lowConfidence: true }),
    );
    expect(r.urgency).toBe("medium");
    expect(r.rationale).toBeNull();
  });
});

describe("computeProposalUrgency — degrading branch", () => {
  test("degrading with trusted sample + 8pp+ drop → high with actionable rationale", () => {
    const r = computeProposalUrgency(
      drift({
        direction: "degrading",
        accuracyDelta: -0.1,
        brierDelta: 0.03,
        lowConfidence: false,
      }),
    );
    expect(r.urgency).toBe("high");
    expect(r.rationale).toBe(
      "Scorer dulled -10pp over the last 90 days — open a scorer PR this week.",
    );
  });

  test("degrading with exactly 8pp drop → high (boundary)", () => {
    const r = computeProposalUrgency(
      drift({ direction: "degrading", accuracyDelta: -0.08, lowConfidence: false }),
    );
    expect(r.urgency).toBe("high");
  });

  test("degrading with 7pp drop → medium, 'slipping' rationale", () => {
    const r = computeProposalUrgency(
      drift({ direction: "degrading", accuracyDelta: -0.07, lowConfidence: false }),
    );
    expect(r.urgency).toBe("medium");
    expect(r.rationale).toBe(
      "Calibration slipping (-7pp) — review these changes at the next weekly cadence.",
    );
  });

  test("degrading + thin sample → medium with directional note (never high)", () => {
    const r = computeProposalUrgency(
      drift({
        direction: "degrading",
        accuracyDelta: -0.25,
        recentN: 5,
        priorN: 4,
        lowConfidence: true,
      }),
    );
    expect(r.urgency).toBe("medium");
    expect(r.rationale).toBe(
      "Directional signal: scorer may be dulling (-25pp) but sample is thin — treat these changes as the usual review queue.",
    );
  });

  test("degrading with null accuracyDelta → medium (defensive)", () => {
    const r = computeProposalUrgency(
      drift({ direction: "degrading", accuracyDelta: null, lowConfidence: false }),
    );
    expect(r.urgency).toBe("medium");
    expect(r.rationale).toContain("slipping");
  });
});

describe("computeProposalUrgency — improving branch", () => {
  test("improving with trusted sample → low with sharpening rationale", () => {
    const r = computeProposalUrgency(
      drift({
        direction: "improving",
        accuracyDelta: 0.12,
        brierDelta: -0.04,
        lowConfidence: false,
      }),
    );
    expect(r.urgency).toBe("low");
    expect(r.rationale).toBe(
      "Scorer is sharpening on its own (+12pp over the last 90 days) — these are polish changes, not firefighting.",
    );
  });

  test("improving with thin sample → medium (no de-escalation on low confidence)", () => {
    const r = computeProposalUrgency(
      drift({
        direction: "improving",
        accuracyDelta: 0.2,
        recentN: 3,
        priorN: 2,
        lowConfidence: true,
      }),
    );
    expect(r.urgency).toBe("medium");
    expect(r.rationale).toBeNull();
  });

  test("improving over a custom windowDays carries through to the copy", () => {
    const r = computeProposalUrgency(
      drift({
        direction: "improving",
        accuracyDelta: 0.09,
        windowDays: 45,
        lowConfidence: false,
      }),
    );
    expect(r.rationale).toBe(
      "Scorer is sharpening on its own (+9pp over the last 45 days) — these are polish changes, not firefighting.",
    );
  });
});

describe("computeProposalUrgency — stable branch", () => {
  test("stable with trusted sample → medium, no rationale (silent)", () => {
    const r = computeProposalUrgency(
      drift({ direction: "stable", accuracyDelta: 0.01, lowConfidence: false }),
    );
    expect(r.urgency).toBe("medium");
    expect(r.rationale).toBeNull();
  });

  test("stable with thin sample → medium, silent", () => {
    const r = computeProposalUrgency(
      drift({ direction: "stable", lowConfidence: true, accuracyDelta: 0.01 }),
    );
    expect(r.urgency).toBe("medium");
    expect(r.rationale).toBeNull();
  });
});

describe("describeProposalUrgencyPill", () => {
  test("high → 'HIGH PRIORITY'", () => {
    expect(describeProposalUrgencyPill("high")).toBe("HIGH PRIORITY");
  });
  test("medium → 'STANDARD'", () => {
    expect(describeProposalUrgencyPill("medium")).toBe("STANDARD");
  });
  test("low → 'LOW URGENCY'", () => {
    expect(describeProposalUrgencyPill("low")).toBe("LOW URGENCY");
  });
});
