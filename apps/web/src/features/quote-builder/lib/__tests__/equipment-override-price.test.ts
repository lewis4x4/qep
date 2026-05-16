import { describe, expect, test } from "bun:test";

import {
  applyEquipmentOverridePrice,
  equipmentOverridePriceCents,
  equipmentSystemBasePrice,
  hasEquipmentOverride,
} from "../equipment-override-price";
import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

const baseLine = (): QuoteLineItemDraft => ({
  kind: "equipment",
  title: "CAT 299D3",
  quantity: 1,
  unitPrice: 100_000,
  metadata: { system_base_unit_price: 100_000 },
});

describe("equipment-override-price", () => {
  test("equipmentSystemBasePrice prefers metadata system base", () => {
    expect(equipmentSystemBasePrice(baseLine())).toBe(100_000);
  });

  test("equipmentOverridePriceCents reads typed column first", () => {
    expect(equipmentOverridePriceCents({
      ...baseLine(),
      unitPrice: 95_000,
      equipmentOverridePriceCents: 9_500_000,
    })).toBe(9_500_000);
  });

  test("equipmentOverridePriceCents falls back to legacy metadata dollars", () => {
    expect(equipmentOverridePriceCents({
      ...baseLine(),
      unitPrice: 95_000,
      metadata: { system_base_unit_price: 100_000, equipment_override_price: 95_000 },
    })).toBe(9_500_000);
  });

  test("applyEquipmentOverridePrice sets cents and strips metadata override", () => {
    const next = applyEquipmentOverridePrice(baseLine(), 97_500);
    expect(next.unitPrice).toBe(97_500);
    expect(next.equipmentOverridePriceCents).toBe(9_750_000);
    expect(next.metadata?.equipment_override_price).toBeUndefined();
    expect(hasEquipmentOverride(next)).toBe(true);
  });

  test("applyEquipmentOverridePrice pins system_base_unit_price on first override", () => {
    const line: QuoteLineItemDraft = {
      kind: "equipment",
      title: "Unit",
      quantity: 1,
      unitPrice: 100_000,
    };
    const next = applyEquipmentOverridePrice(line, 97_500);
    expect(next.metadata?.system_base_unit_price).toBe(100_000);
  });

  test("applyEquipmentOverridePrice clears override at system base", () => {
    const overridden = applyEquipmentOverridePrice(baseLine(), 97_500);
    const reset = applyEquipmentOverridePrice(overridden, 100_000);
    expect(reset.equipmentOverridePriceCents).toBeNull();
    expect(hasEquipmentOverride(reset)).toBe(false);
  });
});
