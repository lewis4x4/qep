import { describe, expect, test } from "bun:test";

import type { QuoteLineItemDraft } from "../../../../../../../shared/qep-moonshot-contracts";

import {
  findPricingLine,
  mergePricingLines,
  pricingFieldKeyForLine,
} from "../pricing-line-mutations";

describe("pricingFieldKeyForLine", () => {
  test("uses explicit pricing_field_key", () => {
    expect(pricingFieldKeyForLine({
      kind: "custom",
      metadata: { pricing_field_key: "misc_charge_1" },
    } as QuoteLineItemDraft)).toBe("misc_charge_1");
  });

  test("maps inbound freight direction", () => {
    expect(pricingFieldKeyForLine({
      kind: "freight",
      metadata: { freight_direction: "inbound" },
    } as QuoteLineItemDraft)).toBe("inbound_freight");
  });
});

describe("mergePricingLines", () => {
  test("appends a new discount line", () => {
    const next = mergePricingLines([], "discount", 100);
    expect(next).toHaveLength(1);
    expect(next[0]?.unitPrice).toBe(100);
    expect(next[0]?.kind).toBe("discount");
  });

  test("removes line when amount is zero", () => {
    const existing: QuoteLineItemDraft[] = [{
      kind: "discount",
      id: "discount-1",
      title: "Discount",
      quantity: 1,
      unitPrice: 50,
    } as QuoteLineItemDraft];
    const next = mergePricingLines(existing, "discount", 0);
    expect(next).toHaveLength(0);
  });

  test("updates matching line by field key", () => {
    const existing: QuoteLineItemDraft[] = [{
      kind: "freight",
      id: "inbound_freight-1",
      title: "Inbound freight to yard",
      quantity: 1,
      unitPrice: 200,
      metadata: { pricing_field_key: "inbound_freight", freight_direction: "inbound" },
    } as QuoteLineItemDraft];
    const next = mergePricingLines(existing, {
      id: "inbound_freight",
      kind: "freight",
      title: "Inbound freight to yard",
      helper: "",
      step: 1,
      costVisibility: "customer",
    }, 350);
    expect(next).toHaveLength(1);
    expect(next[0]?.unitPrice).toBe(350);
  });
});

describe("findPricingLine", () => {
  test("finds by pricing field id", () => {
    const lines: QuoteLineItemDraft[] = [{
      kind: "pdi",
      id: "pdi-1",
      title: "PDI",
      quantity: 1,
      unitPrice: 75,
    } as QuoteLineItemDraft];
    expect(findPricingLine(lines, "pdi")?.unitPrice).toBe(75);
  });
});
