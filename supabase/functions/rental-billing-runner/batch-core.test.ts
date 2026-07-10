import { describe, expect, it } from "bun:test";
import { clampInteger, mapWithConcurrency } from "./batch-core";

describe("rental billing bounded batch core", () => {
  it("clamps untrusted batch controls", () => {
    expect(clampInteger(undefined, 25, 1, 100)).toBe(25);
    expect(clampInteger(Number.NaN, 4, 1, 8)).toBe(4);
    expect(clampInteger(0, 25, 1, 100)).toBe(1);
    expect(clampInteger(500, 25, 1, 100)).toBe(100);
    expect(clampInteger(7.9, 4, 1, 8)).toBe(7);
  });

  it("examines a >500 cohort with bounded concurrency and poison isolation", async () => {
    const cohort = Array.from({ length: 625 }, (_, index) => index);
    const visited: number[] = [];
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency(cohort, 5, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      visited.push(item);
      active--;
      if (item === 17) throw new Error("poison contract");
      return item * 2;
    });

    expect(results).toHaveLength(625);
    expect(results.filter((result) => result.status === "fulfilled"))
      .toHaveLength(624);
    expect(results.filter((result) => result.status === "rejected"))
      .toHaveLength(1);
    expect(results[17].status).toBe("rejected");
    expect(results[624]).toEqual({ status: "fulfilled", value: 1_248 });
    expect(new Set(visited).size).toBe(625);
    expect(maxActive).toBeLessThanOrEqual(5);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("preserves result order even when workers finish out of order", async () => {
    const results = await mapWithConcurrency([30, 5, 20], 3, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay;
    });
    expect(results).toEqual([
      { status: "fulfilled", value: 30 },
      { status: "fulfilled", value: 5 },
      { status: "fulfilled", value: 20 },
    ]);
  });
});
