import { describe, expect, test } from "bun:test";

import type { QuoteLineItemDraft } from "../../../../../../../shared/qep-moonshot-contracts";

import { miscPricingLineKey } from "../PricingAdderBuckets";

describe("miscPricingLineKey", () => {
  test("prefers line id", () => {
    const line: QuoteLineItemDraft = {
      id: "line-1",
      kind: "custom",
      title: "Wrap",
      quantity: 1,
      unitPrice: 500,
      metadata: { misc_line_kind: "charge", pricing_field_key: "misc_charge_1" },
    };
    expect(miscPricingLineKey(line)).toBe("line-1");
  });

  test("falls back to pricing_field_key when id missing", () => {
    const line: QuoteLineItemDraft = {
      kind: "custom",
      title: "Wrap",
      quantity: 1,
      unitPrice: 500,
      metadata: { misc_line_kind: "charge", pricing_field_key: "misc_charge_99" },
    };
    expect(miscPricingLineKey(line)).toBe("misc_charge_99");
  });

  test("falls back to kind:title when id and field key missing", () => {
    const line: QuoteLineItemDraft = {
      kind: "discount",
      title: "Down payment",
      quantity: 1,
      unitPrice: 1000,
      metadata: { misc_line_kind: "credit" },
    };
    expect(miscPricingLineKey(line)).toBe("credit:Down payment");
  });
});
