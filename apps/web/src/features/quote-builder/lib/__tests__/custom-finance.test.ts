import { describe, expect, test } from "bun:test";

import { buildCustomFinanceScenario } from "../custom-finance";

describe("buildCustomFinanceScenario", () => {
  test("returns null when the optional custom finance section is disabled", () => {
    expect(buildCustomFinanceScenario({
      enabled: false,
      amountFinanced: 25_000,
      ratePct: 6.5,
      termMonths: 60,
    })).toBeNull();
  });

  test("calculates a zero-interest custom scenario", () => {
    const scenario = buildCustomFinanceScenario({
      enabled: true,
      amountFinanced: 24_000,
      ratePct: 0,
      termMonths: 48,
    });

    expect(scenario?.label).toBe("Custom Finance 48 mo");
    expect(scenario?.monthlyPayment).toBe(500);
    expect(scenario?.totalCost).toBe(24_000);
  });

  test("calculates an amortized monthly payment for positive interest", () => {
    const scenario = buildCustomFinanceScenario({
      enabled: true,
      amountFinanced: 24_850.44,
      ratePct: 7.5,
      termMonths: 60,
    });

    expect(scenario?.type).toBe("finance");
    expect(scenario?.termMonths).toBe(60);
    expect(scenario?.monthlyPayment).toBeGreaterThan(400);
    expect(scenario?.monthlyPayment).toBeLessThan(600);
  });
});
