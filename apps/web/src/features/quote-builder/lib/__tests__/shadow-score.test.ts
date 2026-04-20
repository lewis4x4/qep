/**
 * Shadow Score tests — Slice 20j.
 *
 * The shadow score is the first counterfactual model surfaced to users,
 * so getting the low-confidence semantics right matters more than
 * getting the exact distance formula right. Test matrix:
 *
 *   • Distance: identical, orphan-only, shared-with-delta, commutative.
 *   • Empty history → empty-history reason, lowConfidence true.
 *   • Sparse sample → sparse-sample reason, lowConfidence true.
 *   • Distant neighbors → distant-neighbors reason, lowConfidence true.
 *   • Tied distances at K-boundary → all tied rows included (kUsed > K).
 *   • Identical-twin neighbor → distance 0, heavy weight on that row.
 *   • Happy path with 10+ history, close neighbors, all-win → score 100.
 *   • describeShadowAgreement phrasing for each reason + delta sign.
 */

import { describe, expect, test } from "bun:test";
import {
  computeShadowScore,
  computeSnapshotDistance,
  describeShadowAgreement,
  SHADOW_K_DEFAULT,
  type ShadowHistoricalSnapshot,
} from "../shadow-score";

const f = (label: string, weight: number) => ({ label, weight });

function makeHistory(
  n: number,
  outcomeFor: (i: number) => "won" | "lost" | "expired",
  factorsFor: (i: number) => Array<{ label: string; weight: number }>,
): ShadowHistoricalSnapshot[] {
  const out: ShadowHistoricalSnapshot[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      packageId: `pkg-${i}`,
      factors: factorsFor(i),
      outcome: outcomeFor(i),
    });
  }
  return out;
}

describe("computeSnapshotDistance", () => {
  test("identical profiles → distance 0", () => {
    const live = [f("A", 5), f("B", -3)];
    const hist = [f("A", 5), f("B", -3)];
    expect(computeSnapshotDistance(live, hist)).toBe(0);
  });

  test("orphan label on live side → +1 per orphan", () => {
    expect(computeSnapshotDistance([f("A", 5)], [])).toBe(1);
    expect(computeSnapshotDistance([f("A", 5), f("B", 2)], [])).toBe(2);
  });

  test("orphan label on historical side → +1 per orphan", () => {
    expect(computeSnapshotDistance([], [f("A", 5)])).toBe(1);
    expect(computeSnapshotDistance([], [f("A", 5), f("B", 2)])).toBe(2);
  });

  test("shared label with delta → |Δweight|", () => {
    expect(computeSnapshotDistance([f("A", 5)], [f("A", 2)])).toBe(3);
    expect(computeSnapshotDistance([f("A", -5)], [f("A", 5)])).toBe(10);
  });

  test("commutative: d(live, hist) === d(hist, live)", () => {
    const a = [f("A", 5), f("B", -3), f("C", 1)];
    const b = [f("A", 2), f("D", 4)];
    expect(computeSnapshotDistance(a, b)).toBe(computeSnapshotDistance(b, a));
  });

  test("drops non-finite / empty labels defensively", () => {
    const live = [f("A", 5), f("", 99), f("B", Number.NaN)];
    const hist = [f("A", 5)];
    // Only "A" counts on both sides; distance is 0.
    expect(computeSnapshotDistance(live, hist)).toBe(0);
  });

  test("weight-0 present is different from label absent", () => {
    // "A" on live at weight 0, absent on historical → orphan +1.
    expect(computeSnapshotDistance([f("A", 0)], [])).toBe(1);
  });
});

describe("computeShadowScore — edge cases", () => {
  test("empty history → empty-history, lowConfidence, score 50", () => {
    const r = computeShadowScore([f("A", 5)], []);
    expect(r.reason).toBe("empty-history");
    expect(r.lowConfidence).toBe(true);
    expect(r.shadowScore).toBe(50);
    expect(r.kUsed).toBe(0);
  });

  test("sparse sample (< K) → sparse-sample reason, lowConfidence true", () => {
    const history = makeHistory(
      3,
      (i) => (i < 2 ? "won" : "lost"),
      () => [f("A", 5)],
    );
    const r = computeShadowScore([f("A", 5)], history);
    expect(r.reason).toBe("sparse-sample");
    expect(r.lowConfidence).toBe(true);
    expect(r.kUsed).toBe(3);
    // 2 of 3 won → 67
    expect(r.shadowScore).toBe(67);
  });

  test("distant neighbors → distant-neighbors reason, lowConfidence true", () => {
    // 12 historical deals that share the "A" label but at very
    // different weights → |Δweight| = 45 per row, well above the
    // default distant threshold of 15.
    const history = makeHistory(
      12,
      (i) => (i % 2 === 0 ? "won" : "lost"),
      () => [f("A", 50)],
    );
    const r = computeShadowScore([f("A", 5)], history);
    expect(r.reason).toBe("distant-neighbors");
    expect(r.lowConfidence).toBe(true);
    // Still averaged — just flagged. Ties at the boundary can push
    // kUsed past K; what we actually care about is that the scorer
    // still produced a shadow.
    expect(r.kUsed).toBeGreaterThanOrEqual(SHADOW_K_DEFAULT);
  });

  test("sparse-sample takes priority over distant-neighbors", () => {
    // Only 2 rows, both far away.
    const history = makeHistory(
      2,
      () => "won",
      () => [f("Z", 50)],
    );
    const r = computeShadowScore([f("A", 1)], history);
    expect(r.reason).toBe("sparse-sample");
    expect(r.lowConfidence).toBe(true);
  });
});

describe("computeShadowScore — happy path", () => {
  test("all K neighbors won → shadow 100, confident", () => {
    // 12 close-to-identical winners. Ties at distance 0 push kUsed
    // past K (all 12 are equally close), which is desired behavior —
    // we'd rather average an honest tie than drop rows arbitrarily.
    const history = makeHistory(
      12,
      () => "won",
      () => [f("A", 5), f("B", -3)],
    );
    const r = computeShadowScore([f("A", 5), f("B", -3)], history);
    expect(r.shadowScore).toBe(100);
    expect(r.lowConfidence).toBe(false);
    expect(r.reason).toBe("ok");
    expect(r.kUsed).toBeGreaterThanOrEqual(SHADOW_K_DEFAULT);
    expect(r.meanDistance).toBe(0);
  });

  test("mixed outcomes → proportional shadow", () => {
    // 10 identical-distance snapshots: 7 won, 3 lost.
    const history = makeHistory(
      10,
      (i) => (i < 7 ? "won" : "lost"),
      () => [f("A", 5)],
    );
    const r = computeShadowScore([f("A", 5)], history);
    expect(r.shadowScore).toBe(70);
    expect(r.lowConfidence).toBe(false);
    expect(r.reason).toBe("ok");
  });

  test("expired folds into loss (matches closed-deals-audit)", () => {
    const history = makeHistory(
      10,
      (i) => (i < 5 ? "won" : "expired"),
      () => [f("A", 5)],
    );
    const r = computeShadowScore([f("A", 5)], history);
    // 5 wins / 10 total → 50
    expect(r.shadowScore).toBe(50);
  });
});

describe("computeShadowScore — tied distances and twins", () => {
  test("identical twin pulls distance to 0 on that neighbor", () => {
    // 12 rows where the first is an identical twin, rest are far.
    const history = makeHistory(
      12,
      (i) => (i === 0 ? "won" : "lost"),
      (i) =>
        i === 0
          ? [f("A", 5), f("B", 3)]
          : [f("Z", 50), f("Y", -50)],
    );
    const r = computeShadowScore([f("A", 5), f("B", 3)], history);
    // With K=10 out of 12 and tied rank on the far ones, the shadow
    // averages twin (won) + 9 or more losers.
    expect(r.kUsed).toBeGreaterThanOrEqual(SHADOW_K_DEFAULT);
    // score ≤ 100 / kUsed * 1
    expect(r.shadowScore).toBeLessThan(20);
  });

  test("ties at K-boundary include all tied rows", () => {
    // 5 wins at distance 0, 7 losses at distance 10 (same distance).
    // With K=10, boundary sits at distance 10, and all 12 rows tie ≤ 10.
    const history = [
      ...makeHistory(5, () => "won", () => [f("A", 0)]),
      ...makeHistory(7, () => "lost", () => [f("A", 10)]),
    ];
    const r = computeShadowScore([f("A", 0)], history);
    expect(r.kUsed).toBe(12);
    // 5 wins / 12 total → 42
    expect(r.shadowScore).toBe(42);
  });
});

describe("computeShadowScore — defensive", () => {
  test("filters malformed history rows", () => {
    const history: ShadowHistoricalSnapshot[] = [
      // Good
      { packageId: "ok", factors: [f("A", 5)], outcome: "won" },
      // Bad: empty packageId
      { packageId: "", factors: [f("A", 5)], outcome: "won" },
      // Bad: bogus outcome
      // @ts-expect-error testing runtime-invalid outcome
      { packageId: "bad", factors: [f("A", 5)], outcome: "other" },
      // Bad: non-array factors
      // @ts-expect-error testing runtime-invalid factors
      { packageId: "nofactors", factors: null, outcome: "lost" },
    ];
    const r = computeShadowScore([f("A", 5)], history);
    // Only the first row survived → 1 win, kUsed=1, sparse
    expect(r.kUsed).toBe(1);
    expect(r.shadowScore).toBe(100);
    expect(r.reason).toBe("sparse-sample");
  });

  test("respects custom k option", () => {
    const history = makeHistory(
      20,
      (i) => (i < 3 ? "won" : "lost"),
      (i) => [f("A", i)], // distance grows with i
    );
    // Live draft matches A=0 exactly; nearest 3 rows are i=0,1,2 (all won)
    const r = computeShadowScore([f("A", 0)], history, { k: 3 });
    expect(r.kUsed).toBe(3);
    expect(r.shadowScore).toBe(100);
    expect(r.lowConfidence).toBe(false);
  });

  test("respects custom distantThreshold", () => {
    const history = makeHistory(
      12,
      () => "won",
      () => [f("A", 5)],
    );
    // Live draft is 3 units away on A. Without override threshold=15 so
    // it's still "close". With a threshold of 1, same data flips to
    // distant-neighbors.
    const base = computeShadowScore([f("A", 2)], history);
    expect(base.reason).toBe("ok");
    const tight = computeShadowScore([f("A", 2)], history, { distantThreshold: 1 });
    expect(tight.reason).toBe("distant-neighbors");
    expect(tight.lowConfidence).toBe(true);
  });
});

describe("describeShadowAgreement", () => {
  test("empty-history → directional copy", () => {
    const msg = describeShadowAgreement(72, {
      shadowScore: 50,
      kUsed: 0,
      meanDistance: 0,
      lowConfidence: true,
      reason: "empty-history",
    });
    expect(msg.toLowerCase()).toContain("not enough closed deals");
  });

  test("sparse-sample pluralizes correctly", () => {
    const one = describeShadowAgreement(60, {
      shadowScore: 80,
      kUsed: 1,
      meanDistance: 2,
      lowConfidence: true,
      reason: "sparse-sample",
    });
    expect(one).toContain("1 close match");
    expect(one).not.toContain("matches");

    const many = describeShadowAgreement(60, {
      shadowScore: 80,
      kUsed: 4,
      meanDistance: 2,
      lowConfidence: true,
      reason: "sparse-sample",
    });
    expect(many).toContain("4 close matches");
  });

  test("agreement when within ±10 points", () => {
    const msg = describeShadowAgreement(60, {
      shadowScore: 65,
      kUsed: 10,
      meanDistance: 3,
      lowConfidence: false,
      reason: "ok",
    });
    expect(msg.toLowerCase()).toContain("agrees");
  });

  test("shadow higher → 'won more often'", () => {
    const msg = describeShadowAgreement(40, {
      shadowScore: 80,
      kUsed: 10,
      meanDistance: 3,
      lowConfidence: false,
      reason: "ok",
    });
    expect(msg.toLowerCase()).toContain("won more often");
  });

  test("shadow lower → 'won less often'", () => {
    const msg = describeShadowAgreement(80, {
      shadowScore: 30,
      kUsed: 10,
      meanDistance: 3,
      lowConfidence: false,
      reason: "ok",
    });
    expect(msg.toLowerCase()).toContain("won less often");
  });
});
