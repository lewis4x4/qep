// QRM Quote Builder — equipment override-price helpers (pure).
//
// Extracted from `QuoteBuilderV2Page.tsx` as PR 8 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence.
// Behavior contract preserved 1:1 with the page-local helpers at
// lines 411-428 of the prior page.
//
// Storage shape today: equipment override price lives in
// `quote_package_line_items.metadata.equipment_override_price` (JSON).
// Plan §5 calls for promoting this to a typed `equipment_override_price_cents`
// column in a follow-up migration (`578_*` after head `577_*`); when that
// lands, this module becomes the single point of update — readers swap
// to the column, writers update the column instead of the JSON. Until
// then, JSON path is the only source of truth.
//
// Margin / approval rules: the **system_base_unit_price** is the
// reference for margin and approval-bypass evaluation; the override is
// what the customer sees on the PDF. `equipmentSystemBasePrice` returns
// the system base when set in metadata, otherwise the line's
// `unitPrice` (back-compat for legacy lines without the metadata).

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

/**
 * Returns a new equipment line with `unitPrice = nextPrice`. When
 * `nextPrice` matches the system base (within $0.01), the override
 * metadata key is **deleted** so analytics queries can distinguish
 * "rep returned the line to system base" from "rep set the override
 * to exactly the system base". When the resulting metadata object is
 * empty, the metadata field is set to `null` to avoid an empty `{}`
 * blob being persisted alongside the row.
 */
export function applyEquipmentOverridePrice(
  line: QuoteLineItemDraft,
  nextPrice: number,
): QuoteLineItemDraft {
  const systemBase = equipmentSystemBasePrice(line);
  const metadata = { ...(line.metadata ?? {}) };
  if (Math.abs(nextPrice - systemBase) < 0.01) {
    delete metadata.equipment_override_price;
  } else {
    metadata.equipment_override_price = nextPrice;
  }
  return {
    ...line,
    unitPrice: nextPrice,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}
