import { describe, expect, it } from "bun:test";
import {
  pulseFromLastSync,
  synthesizeSyncPulsePoints,
} from "../src/features/qrm/components/PulseSparkline";

describe("pulseFromLastSync", () => {
  const now = new Date("2026-04-20T12:00:00.000Z");

  it("returns cold intent when last sync is unknown", () => {
    const result = pulseFromLastSync(null, now);
    expect(result.intent).toBe("cold");
    expect(result.hoursAgo).toBeNull();
  });

  it("returns live intent for a recent sync (<= 24h)", () => {
    const lastSync = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3h ago
    const result = pulseFromLastSync(lastSync, now);
    expect(result.intent).toBe("live");
    expect(result.label).toBe("3h ago");
  });

  it("returns warming intent for 24h–72h", () => {
    const lastSync = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 2d
    const result = pulseFromLastSync(lastSync, now);
    expect(result.intent).toBe("warming");
    expect(result.label).toBe("2d ago");
  });

  it("returns cool intent for 3d–7d", () => {
    const lastSync = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const result = pulseFromLastSync(lastSync, now);
    expect(result.intent).toBe("cool");
    expect(result.label).toBe("5d ago");
  });

  it("returns cold intent for > 7d", () => {
    const lastSync = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const result = pulseFromLastSync(lastSync, now);
    expect(result.intent).toBe("cold");
    // 14 days renders as 2w ago.
    expect(result.label).toBe("2w ago");
  });

  it("handles future timestamps gracefully", () => {
    const future = new Date(now.getTime() + 60 * 60 * 1000);
    const result = pulseFromLastSync(future, now);
    expect(result.intent).toBe("live");
  });

  it("accepts ISO strings and Date instances equivalently", () => {
    const lastSync = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const fromDate = pulseFromLastSync(lastSync, now);
    const fromIso = pulseFromLastSync(lastSync.toISOString(), now);
    expect(fromDate.intent).toBe(fromIso.intent);
    expect(fromDate.label).toBe(fromIso.label);
  });
});

describe("synthesizeSyncPulsePoints", () => {
  const now = new Date("2026-04-20T12:00:00.000Z");

  it("returns exactly 7 points", () => {
    const points = synthesizeSyncPulsePoints(new Date(now.getTime() - 1000), now);
    expect(points.length).toBe(7);
  });

  it("returns a dim flat line when lastSyncAt is null", () => {
    const points = synthesizeSyncPulsePoints(null, now);
    expect(points.length).toBe(7);
    // All values should be below 0.5 (dim baseline).
    for (const value of points) {
      expect(value).toBeLessThan(0.5);
    }
  });

  it("clamps all points to the [0, 1] range", () => {
    const points = synthesizeSyncPulsePoints(now, now);
    for (const value of points) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("produces lower baseline for stale sync vs fresh sync", () => {
    const stale = synthesizeSyncPulsePoints(
      new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      now,
    );
    const fresh = synthesizeSyncPulsePoints(now, now);
    const staleAvg = stale.reduce((a, b) => a + b, 0) / stale.length;
    const freshAvg = fresh.reduce((a, b) => a + b, 0) / fresh.length;
    expect(freshAvg).toBeGreaterThan(staleAvg);
  });
});
