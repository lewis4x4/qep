// QRM Quote Builder — equipment override-price helpers (pure).
//
// Override storage: `quote_package_line_items.equipment_override_price_cents`
// (migration 578). Legacy drafts may still carry metadata.equipment_override_price
// (dollars); readers accept both until backfill is complete.

import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

/**
 * The system-quoted reference price for an equipment line. Reads
 * `metadata.system_base_unit_price` if present (string or number), and
 * falls back to `line.unitPrice` for legacy lines that pre-date the
 * metadata convention.
 */
export function equipmentSystemBasePrice(line: QuoteLineItemDraft): number {
  const raw = line.metadata?.system_base_unit_price;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return line.unitPrice;
}

function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Typed override in cents when the rep price differs from system base.
 * Falls back to legacy metadata dollars when the column was not hydrated.
 */
export function equipmentOverridePriceCents(line: QuoteLineItemDraft): number | null {
  if (line.equipmentOverridePriceCents != null && Number.isFinite(line.equipmentOverridePriceCents)) {
    return Math.round(line.equipmentOverridePriceCents);
  }
  const raw = line.metadata?.equipment_override_price;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return dollarsToCents(raw);
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return dollarsToCents(parsed);
  }
  return null;
}

export function hasEquipmentOverride(line: QuoteLineItemDraft): boolean {
  return equipmentOverridePriceCents(line) != null;
}

/**
 * Returns a new equipment line with `unitPrice = nextPrice`. When
 * `nextPrice` matches the system base (within $0.01), the override
 * column is cleared. When it differs, `equipmentOverridePriceCents` is set.
 */
export function applyEquipmentOverridePrice(
  line: QuoteLineItemDraft,
  nextPrice: number,
): QuoteLineItemDraft {
  const systemBase = equipmentSystemBasePrice(line);
  const metadata = { ...(line.metadata ?? {}) };
  if (metadata.system_base_unit_price == null) {
    metadata.system_base_unit_price = systemBase;
  }
  delete metadata.equipment_override_price;

  const equipmentOverridePriceCentsValue =
    Math.abs(nextPrice - systemBase) < 0.01 ? null : dollarsToCents(nextPrice);

  return {
    ...line,
    unitPrice: nextPrice,
    equipmentOverridePriceCents: equipmentOverridePriceCentsValue,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}
