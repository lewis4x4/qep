/**
 * Scorer Calibration tests — Slice 20f.
 *
 * Coverage philosophy: this is the ground-truth baseline for every
 * future win-probability ML model. If the arithmetic is wrong, every
 * downstream claim ("ML beats baseline by X%") is wrong. So we test
 * both the happy path AND every edge case that could silently produce
 * a plausible-but-wrong number.
 */

import { describe, expect, test } from "bun:test";
import {
  calibrationHeadline,
  computeCalibrationReport,
  formatPct,
  scoreToBand,
  type CalibrationObservation,
} from "../scorer-calibration";

describe("scoreToBand", () => {
  test("maps known boundaries to correct bands", () => {
    expect(scoreToBand(100)).toBe("strong");
    expect(scoreToBand(70)).toBe("strong");
    expect(scoreToBand(69)).toBe("healthy");
    expect(scoreToBand(55)).toBe("healthy");
    expect(scoreToBand(54)).toBe("mixed");
    expect(scoreToBand(35)).toBe("mixed");
    expect(scoreToBand(34)).toBe("at_risk");
    expect(scoreToBand(0)).toBe("at_risk");
  });
});

describe("computeCalibrationReport — empty + malformed inputs", () => {
  test("empty input produces zero-sample report with lowConfidence=false (semantically 'no data', not 'small sample')", () => {
    const r = computeCalibrationReport([]);
    expect(r.sampleSize).toBe(0);
    expect(r.accuracyPct).toBeNull();
    expect(r.brierScore).toBeNull();
    // Important: zero sample is NOT "low confidence" — it is "no data".
    // The UI uses sampleSize===0 to render a distinct empty state.
    expect(r.lowConfidence).toBe(false);
    expect(r.bands.every((b) => b.n === 0 && b.winRate === null)).toBe(true);
  });

  test("filters out malformed rows defensively", () => {
    const obs: CalibrationObservation[] = [
      { score: Number.NaN, outcome: "won" },
      { score: -5, outcome: "won" },
      { score: 150, outcome: "won" },
      // deno-lint-ignore no-explicit-any
      { score: 80, outcome: "maybe" as any },
      { score: 80, outcome: "won" }, // the only valid row
    ];
    const r = computeCalibrationReport(obs);
    expect(r.sampleSize).toBe(1);
  });

  test("skipped outcomes are excluded (caller should filter first but we are defensive)", () => {
    const obs: CalibrationObservation[] = [
      // deno-lint-ignore no-explicit-any
      { score: 80, outcome: "skipped" as any },
      { score: 80, outcome: "won" },
    ];
    const r = computeCalibrationReport(obs);
    expect(r.sampleSize).toBe(1);
  });
});

describe("computeCalibrationReport — perfect calibration", () => {
  test("scorer perfectly aligned with reality → 100% accuracy, low Brier", () => {
    const obs: CalibrationObservation[] = [
      { score: 90, outcome: "won" },
      { score: 85, outcome: "won" },
      { score: 60, outcome: "won" }, // healthy band, won
      { score: 50, outcome: "lost" }, // mixed band, lost
      { score: 20, outcome: "lost" }, // at_risk, lost
      { score: 15, outcome: "expired" }, // at_risk, treated as "not won"
    ];
    const r = computeCalibrationReport(obs);
    expect(r.sampleSize).toBe(6);
    expect(r.accuracyPct).toBe(1);
    // Perfect calibration still has some Brier error because e.g. a
    // 90-score deal has 10% predicted-loss, but actually won (error 0.01).
    expect(r.brierScore).toBeGreaterThan(0);
    expect(r.brierScore).toBeLessThan(0.2);
  });
});

describe("computeCalibrationReport — inverse calibration (scorer is worse than random)", () => {
  test("every strong deal lost, every at-risk won → 0% accuracy, high Brier", () => {
    const obs: CalibrationObservation[] = [
      { score: 90, outcome: "lost" },
      { score: 85, outcome: "lost" },
      { score: 20, outcome: "won" },
      { score: 15, outcome: "won" },
    ];
    const r = computeCalibrationReport(obs);
    expect(r.accuracyPct).toBe(0);
    expect(r.brierScore).toBeGreaterThan(0.5); // Worse than 50/50 baseline
  });
});

describe("computeCalibrationReport — band breakdown", () => {
  test("per-band counters + win-rate compute correctly", () => {
    const obs: CalibrationObservation[] = [
      // strong band: 2 won, 1 lost
      { score: 90, outcome: "won" },
      { score: 85, outcome: "won" },
      { score: 75, outcome: "lost" },
      // healthy band: 1 won, 1 lost
      { score: 65, outcome: "won" },
      { score: 60, outcome: "lost" },
      // mixed band: 0 won, 2 lost
      { score: 50, outcome: "lost" },
      { score: 40, outcome: "expired" },
      // at_risk band: 1 won, 3 lost
      { score: 30, outcome: "won" },
      { score: 25, outcome: "lost" },
      { score: 20, outcome: "lost" },
      { score: 10, outcome: "expired" },
    ];
    const r = computeCalibrationReport(obs);
    const strong = r.bands.find((b) => b.band === "strong")!;
    expect(strong.n).toBe(3);
    expect(strong.won).toBe(2);
    expect(strong.lost).toBe(1);
    expect(strong.winRate).toBeCloseTo(2 / 3, 5);

    const healthy = r.bands.find((b) => b.band === "healthy")!;
    expect(healthy.n).toBe(2);
    expect(healthy.winRate).toBe(0.5);

    const mixed = r.bands.find((b) => b.band === "mixed")!;
    expect(mixed.n).toBe(2);
    expect(mixed.won).toBe(0);
    expect(mixed.winRate).toBe(0);

    const atRisk = r.bands.find((b) => b.band === "at_risk")!;
    expect(atRisk.n).toBe(4);
    expect(atRisk.won).toBe(1);
    expect(atRisk.winRate).toBe(0.25);
  });

  test("empty band returns winRate=null (not 0) so UI can show '—' vs 0%", () => {
    const obs: CalibrationObservation[] = [{ score: 90, outcome: "won" }];
    const r = computeCalibrationReport(obs);
    const healthy = r.bands.find((b) => b.band === "healthy")!;
    expect(healthy.n).toBe(0);
    expect(healthy.winRate).toBeNull();
  });
});

describe("computeCalibrationReport — lowConfidence flag", () => {
  test("samples under 10 → lowConfidence true", () => {
    const obs: CalibrationObservation[] = Array.from({ length: 9 }, (_, i) => ({
      score: 80 - i,
      outcome: "won" as const,
    }));
    const r = computeCalibrationReport(obs);
    expect(r.sampleSize).toBe(9);
    expect(r.lowConfidence).toBe(true);
  });

  test("samples >= 10 → lowConfidence false", () => {
    const obs: CalibrationObservation[] = Array.from({ length: 10 }, (_, i) => ({
      score: 80 - i,
      outcome: "won" as const,
    }));
    const r = computeCalibrationReport(obs);
    expect(r.lowConfidence).toBe(false);
  });
});

describe("formatPct", () => {
  test("null → em-dash", () => {
    expect(formatPct(null)).toBe("—");
  });
  test("0.67 → '67%'", () => {
    expect(formatPct(0.67)).toBe("67%");
  });
  test("1 → '100%'", () => {
    expect(formatPct(1)).toBe("100%");
  });
  test("0 → '0%'", () => {
    expect(formatPct(0)).toBe("0%");
  });
  test("digits option respects precision", () => {
    expect(formatPct(0.6789, { digits: 1 })).toBe("67.9%");
  });
});

describe("calibrationHeadline", () => {
  test("zero-sample headline points at missing data", () => {
    const r = computeCalibrationReport([]);
    expect(calibrationHeadline(r)).toMatch(/No closed deals/i);
  });

  test("low-confidence headline says 'directional only'", () => {
    const obs: CalibrationObservation[] = [{ score: 80, outcome: "won" }];
    const r = computeCalibrationReport(obs);
    expect(calibrationHeadline(r)).toMatch(/Directional only/i);
    expect(calibrationHeadline(r)).toMatch(/1 closed deal/);
  });

  test("confident sample reports accuracy with sample size", () => {
    const obs: CalibrationObservation[] = Array.from({ length: 20 }, (_, i) => ({
      score: i < 10 ? 85 : 20,
      outcome: (i < 10 ? "won" : "lost") as "won" | "lost",
    }));
    const r = computeCalibrationReport(obs);
    const line = calibrationHeadline(r);
    expect(line).toMatch(/100%/);
    expect(line).toMatch(/20/);
  });
});

describe("Brier score correctness", () => {
  test("a scorer that always predicts 50 gets brier=0.25 — the coin-flip baseline", () => {
    const obs: CalibrationObservation[] = [
      { score: 50, outcome: "won" }, // (0.5 - 1)^2 = 0.25
      { score: 50, outcome: "lost" }, // (0.5 - 0)^2 = 0.25
      { score: 50, outcome: "won" },
      { score: 50, outcome: "lost" },
    ];
    const r = computeCalibrationReport(obs);
    expect(r.brierScore).toBe(0.25);
  });

  test("a scorer that predicts 100 and is right gets brier=0 — perfect confidence + perfect result", () => {
    const obs: CalibrationObservation[] = [
      { score: 100, outcome: "won" },
      { score: 100, outcome: "won" },
    ];
    const r = computeCalibrationReport(obs);
    expect(r.brierScore).toBe(0);
  });
});
