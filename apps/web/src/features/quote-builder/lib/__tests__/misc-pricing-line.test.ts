import { describe, expect, test } from "bun:test";

import {
  buildMiscPricingAdderField,
  miscPricingLineKey,
  resolveMiscPricingLineInput,
} from "../misc-pricing-line";

describe("miscPricingLineKey", () => {
  test("prefers line id", () => {
    expect(miscPricingLineKey({ id: "line-1", title: "x" } as never)).toBe("line-1");
  });
});

describe("resolveMiscPricingLineInput", () => {
  test("returns null for non-positive amounts", () => {
    expect(resolveMiscPricingLineInput("charge", {
      chargeTitle: "Fee",
      chargeAmount: 0,
      creditTitle: "",
      creditAmount: 0,
    })).toBeNull();
  });

  test("defaults empty charge title", () => {
    expect(resolveMiscPricingLineInput("charge", {
      chargeTitle: "  ",
      chargeAmount: 50,
      creditTitle: "",
      creditAmount: 0,
    })).toEqual({ title: "Misc charge", amount: 50 });
  });

  test("uses credit fields for credit kind", () => {
    expect(resolveMiscPricingLineInput("credit", {
      chargeTitle: "",
      chargeAmount: 0,
      creditTitle: "Rebate",
      creditAmount: 25,
    })).toEqual({ title: "Rebate", amount: 25 });
  });
});

describe("buildMiscPricingAdderField", () => {
  test("maps charge to custom kind", () => {
    const field = buildMiscPricingAdderField("charge", "Setup", 1);
    expect(field.kind).toBe("custom");
    expect(field.id).toBe("misc_charge_1");
    expect(field.metadata?.misc_line_kind).toBe("charge");
  });

  test("maps credit to discount kind", () => {
    const field = buildMiscPricingAdderField("credit", "Goodwill", 2);
    expect(field.kind).toBe("discount");
    expect(field.id).toBe("misc_credit_2");
  });
});
