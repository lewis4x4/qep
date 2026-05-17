import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

import type { QuotePackageCatalogItem } from "./quote-api";
import { buildEquipmentLine, equipmentKeyForLine, type CatalogEntryMatch } from "./quote-builder-page-helpers";

export function mergeUniqueEquipmentLine(
  equipment: QuoteLineItemDraft[],
  line: QuoteLineItemDraft,
): QuoteLineItemDraft[] {
  const nextKey = equipmentKeyForLine(line);
  return equipment.some((item) => equipmentKeyForLine(item) === nextKey)
    ? equipment
    : [...equipment, line];
}

export function mergeUniqueAttachmentLine(
  attachments: QuoteLineItemDraft[],
  line: QuoteLineItemDraft,
): QuoteLineItemDraft[] {
  const nextKey = equipmentKeyForLine(line);
  return attachments.some((item) => equipmentKeyForLine(item) === nextKey)
    ? attachments
    : [...attachments, line];
}

export function buildPackageCatalogLine(entry: QuotePackageCatalogItem): QuoteLineItemDraft {
  return {
    kind: entry.kind,
    id: entry.id,
    sourceCatalog: entry.sourceCatalog,
    sourceId: entry.sourceId,
    dealerCost: entry.dealerCost,
    title: entry.name,
    quantity: 1,
    unitPrice: entry.price,
    metadata: {
      ...(entry.metadata ?? {}),
      brand_name: entry.brandName ?? null,
      category: entry.category ?? null,
      universal: entry.universal,
    },
  };
}

export function catalogAttachmentToPackageItem(entry: {
  id: string;
  name: string;
  price: number;
  brandName?: string | null;
  category?: string | null;
  universal?: boolean;
}): QuotePackageCatalogItem {
  return {
    id: entry.id,
    kind: "attachment",
    name: entry.name,
    price: entry.price,
    dealerCost: null,
    brandName: entry.brandName ?? null,
    category: entry.category ?? null,
    universal: entry.universal === true,
    sourceCatalog: "qb_attachments",
    sourceId: entry.id,
    metadata: {
      catalog_kind: entry.universal ? "universal_attachment" : "attachment",
      brand_name: entry.brandName ?? null,
      category: entry.category ?? null,
    },
  };
}

export function buildEquipmentLineFromCatalog(entry: CatalogEntryMatch): QuoteLineItemDraft {
  return buildEquipmentLine(entry);
}
