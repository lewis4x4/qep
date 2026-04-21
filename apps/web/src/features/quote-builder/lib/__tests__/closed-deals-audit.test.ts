/**
 * Closed-Deals Audit tests — Slice 20h.
 *
 * Same philosophy as scorer-calibration / factor-attribution: this is
 * the math the manager will triage from. Cover:
 *   - realized mapping (won/lost/expired)
 *   - delta sign convention (+ = over-optimistic)
 *   - miss threshold exactly at the boundary
 *   - sort order
 *   - malformed-row rejection
 *   - top-factor selection uses |weight|, not signed weight
 */

import { describe, expect, test } from "bun:test";
import {
  auditRow,
  computeClosedDealsAudit,
  formatAuditSummary,
  MISS_THRESHOLD,
  realizedProbability,
  type ClosedDealAuditRow,
} from "../closed-deals-audit";

function row(overrides: Partial<ClosedDealAuditRow> = {}): ClosedDealAuditRow {
  return {
    packageId: "pkg-" + Math.random().toString(36).slice(2, 8),
    score: 50,
    outcome: "won",
    factors: [],
    capturedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("realizedProbability", () => {
  test("won → 100", () => expect(realizedProbability("won")).toBe(100));
  test("lost → 0", () => expect(realizedProbability("lost")).toBe(0));
  test("expired folds into loss (0) to match scorer-calibration's didWin mapping", () => {
    // An expired quote that never converted is, for the purposes of
    // 'did the scorer get it right?', not a win. We don't want to give
    // partial credit for a misread prediction just because the deal
    // timed out instead of being actively lost.
    expect(realizedProbability("expired")).toBe(0);
  });
});

describe("auditRow — delta sign convention", () => {
  test("high predict + loss → large positive delta (over-optimistic)", () => {
    const a = auditRow(row({ score: 80, outcome: "lost" }));
    expect(a.delta).toBe(80);
    expect(a.missed).toBe(true);
  });

  test("low predict + win → large negative delta (under-optimistic)", () => {
    const a = auditRow(row({ score: 20, outcome: "won" }));
    expect(a.delta).toBe(-80);
    expect(a.missed).toBe(true);
  });

  test("perfect call on a win → delta 0", () => {
    const a = auditRow(row({ score: 100, outcome: "won" }));
    expect(a.delta).toBe(0);
    expect(a.missed).toBe(false);
  });

  test("expired is treated as a loss (realized=0) — same as scorer-calibration", () => {
    const a = auditRow(row({ score: 60, outcome: "expired" }));
    expect(a.realized).toBe(0);
    expect(a.delta).toBe(60);
    expect(a.missed).toBe(true);
  });
});

describe("auditRow — score clamping + rounding", () => {
  test("score above 100 clamps to 100", () => {
    expect(auditRow(row({ score: 150, outcome: "won" })).predicted).toBe(100);
  });
  test("score below 0 clamps to 0", () => {
    expect(auditRow(row({ score: -5, outcome: "lost" })).predicted).toBe(0);
  });
  test("non-finite score clamps to 0", () => {
    expect(auditRow(row({ score: NaN, outcome: "lost" })).predicted).toBe(0);
  });
  test("decimal score rounds to nearest int", () => {
    expect(auditRow(row({ score: 72.6, outcome: "won" })).predicted).toBe(73);
  });
});

describe("auditRow — miss threshold boundary", () => {
  test(`|delta| exactly at ${MISS_THRESHOLD} counts as a miss`, () => {
    const a = auditRow(row({ score: MISS_THRESHOLD, outcome: "lost" }));
    expect(Math.abs(a.delta)).toBe(MISS_THRESHOLD);
    expect(a.missed).toBe(true);
  });
  test(`|delta| one point under ${MISS_THRESHOLD} is not a miss`, () => {
    const a = auditRow(row({ score: MISS_THRESHOLD - 1, outcome: "lost" }));
    expect(a.missed).toBe(false);
  });
});

describe("auditRow — top factors", () => {
  test("sorts by absolute weight and takes top 3", () => {
    const a = auditRow(
      row({
        score: 70,
        outcome: "won",
        factors: [
          { label: "A", weight: 1 },
          { label: "B", weight: -8 },
          { label: "C", weight: 3 },
          { label: "D", weight: 15 },
          { label: "E", weight: -2 },
        ],
      }),
    );
    expect(a.topFactors.map((f) => f.label)).toEqual(["D", "B", "C"]);
  });

  test("drops factors with non-finite weight or blank label", () => {
    const a = auditRow(
      row({
        score: 70,
        outcome: "won",
        factors: [
          { label: "A", weight: NaN },
          { label: "", weight: 10 },
          { label: "Real", weight: 5 },
        ],
      }),
    );
    expect(a.topFactors.map((f) => f.label)).toEqual(["Real"]);
  });

  test("fewer than 3 factors → returns all", () => {
    const a = auditRow(
      row({
        score: 70,
        outcome: "won",
        factors: [{ label: "Only", weight: 5 }],
      }),
    );
    expect(a.topFactors).toHaveLength(1);
  });
});

describe("computeClosedDealsAudit — pipeline", () => {
  test("empty input returns empty array", () => {
    expect(computeClosedDealsAudit([])).toEqual([]);
  });

  test("filters malformed rows (missing packageId, bad score, bad outcome, non-array factors)", () => {
    const rows: ClosedDealAuditRow[] = [
      // deno-lint-ignore no-explicit-any
      { ...row(), packageId: "" as any },
      row({ score: Number.NaN }),
      // deno-lint-ignore no-explicit-any
      row({ outcome: "skipped" as any }),
      // deno-lint-ignore no-explicit-any
      { ...row(), factors: null as any },
      row({ packageId: "keeper", score: 70, outcome: "won" }),
    ];
    const out = computeClosedDealsAudit(rows);
    expect(out).toHaveLength(1);
    expect(out[0].packageId).toBe("keeper");
  });

  test("sorts by |delta| desc — worst misses first", () => {
    const rows: ClosedDealAuditRow[] = [
      row({ packageId: "small", score: 52, outcome: "won" }), // delta -48
      row({ packageId: "tiny", score: 48, outcome: "won" }), // delta -52
      row({ packageId: "huge", score: 90, outcome: "lost" }), // delta +90
      row({ packageId: "on-target", score: 99, outcome: "won" }), // delta -1
    ];
    const out = computeClosedDealsAudit(rows);
    expect(out.map((a) => a.packageId)).toEqual(["huge", "tiny", "small", "on-target"]);
  });
});

describe("formatAuditSummary", () => {
  test("over-optimistic read", () => {
    const a = auditRow(row({ score: 80, outcome: "lost" }));
    expect(formatAuditSummary(a)).toBe(
      "Predicted 80%, deal lost — 80 points too optimistic",
    );
  });
  test("under-optimistic read", () => {
    const a = auditRow(row({ score: 20, outcome: "won" }));
    expect(formatAuditSummary(a)).toBe(
      "Predicted 20%, deal won — 80 points too pessimistic",
    );
  });
  test("on target (delta 0) uses cleaner 'scorer on target' phrasing", () => {
    const a = auditRow(row({ score: 0, outcome: "lost" }));
    expect(formatAuditSummary(a)).toBe("Predicted 0%, deal lost — scorer on target");
  });
  test("expired wording — expired now folds into loss (realized=0)", () => {
    const a = auditRow(row({ score: 90, outcome: "expired" }));
    expect(formatAuditSummary(a)).toBe(
      "Predicted 90%, deal expired — 90 points too optimistic",
    );
  });
});
