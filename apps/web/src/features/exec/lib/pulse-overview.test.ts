import { describe, expect, test } from "bun:test";
import { deriveBusinessPosture, rankLensPressure } from "./pulse-overview";

describe("deriveBusinessPosture", () => {
  test("marks high-pressure situations as intervene", () => {
    expect(
      deriveBusinessPosture({
        criticalAlerts: 3,
        staleMetrics: 1,
        totalImpact: 50_000,
      }),
    ).toEqual({
      label: "Intervene",
      tone: "red",
      detail: "Leadership attention is required now across multiple pressure points.",
    });
  });

  test("marks moderate pressure as watch", () => {
    expect(
      deriveBusinessPosture({
        criticalAlerts: 1,
        staleMetrics: 0,
        totalImpact: 10_000,
      }),
    ).toEqual({
      label: "Watch",
      tone: "yellow",
      detail: "The business is moving, but there are visible signals leadership should stay ahead of.",
    });
  });

  test("marks quiet posture as stable", () => {
    expect(
      deriveBusinessPosture({
        criticalAlerts: 0,
        staleMetrics: 0,
        totalImpact: 0,
      }),
    ).toEqual({
      label: "Stable",
      tone: "green",
      detail: "No elevated alert pressure is visible across the executive stack right now.",
    });
  });
});

describe("rankLensPressure", () => {
  test("sorts by critical alerts, then total alerts, then stale metrics", () => {
    const ranked = rankLensPressure([
      { role: "ceo", label: "CEO", alerts: 3, criticalAlerts: 1, staleMetrics: 1 },
      { role: "cfo", label: "CFO", alerts: 2, criticalAlerts: 2, staleMetrics: 0 },
      { role: "coo", label: "COO", alerts: 4, criticalAlerts: 1, staleMetrics: 3 },
    ]);

    expect(ranked.map((entry) => entry.role)).toEqual(["cfo", "coo", "ceo"]);
  });
});
