/**
 * Step 8: Attachment pricing
 *
 * Each catalog attachment follows the same dealer-discount path as the machine,
 * then a 20% markup (brand.attachment_markup_pct). Custom (non-catalog) attachments
 * can have a negotiated sales price or follow the same formula.
 *
 * Non-OEM attachments cannot be financed unless rolled into the machine price
 * (up to list cap). That check lives in programs.ts.
 */

import type {
  AttachmentsResult,
  PricedAttachment,
  PricedBrand,
} from "./types";
import { PricingError } from "./errors";

interface PriceAttachmentsInput {
  brand: PricedBrand;
  catalogAttachments: Array<{
    id: string;
    name: string;
    list_price_cents: number;
    oem_branded: boolean;
    compatible_model_ids: string[] | null;
    universal: boolean;
  }>;
  requestedAttachments: Array<{ attachmentId: string; quantity?: number }>;
  customAttachments: Array<{
    description: string;
    costCents: number;
    salesPriceCents?: number;
    oemBranded: boolean;
  }>;
}

export function priceAttachments(input: PriceAttachmentsInput): AttachmentsResult {
  const { brand, catalogAttachments, requestedAttachments, customAttachments } = input;

  const priced: PricedAttachment[] = [];

  // Catalog attachments
  for (const req of requestedAttachments) {
    const cat = catalogAttachments.find((a) => a.id === req.attachmentId);
    if (!cat) {
      throw new PricingError(
        "ATTACHMENT_NOT_FOUND",
        `Attachment ${req.attachmentId} wasn't found in the catalog. It may have been removed or is in a different workspace.`,
        { attachmentId: req.attachmentId },
      );
    }

    const qty = req.quantity ?? 1;
    const listPriceCents = cat.list_price_cents;
    const discountCents = Math.round(listPriceCents * brand.dealerDiscountPct);
    const costCents = listPriceCents - discountCents;
    const markupCents = Math.round(costCents * brand.attachmentMarkupPct);
    const salesPriceCents = costCents + markupCents;

    priced.push({
      attachmentId: cat.id,
      description: cat.name,
      quantity: qty,
      listPriceCents: listPriceCents * qty,
      discountCents: discountCents * qty,
      costCents: costCents * qty,
      markupPct: brand.attachmentMarkupPct,
      markupCents: markupCents * qty,
      salesPriceCents: salesPriceCents * qty,
      oemBranded: cat.oem_branded,
    });
  }

  // Custom (non-catalog) attachments
  for (const custom of customAttachments) {
    const costCents = custom.costCents;
    let salesPriceCents: number;
    let markupCents: number;

    if (custom.salesPriceCents != null) {
      salesPriceCents = custom.salesPriceCents;
      markupCents = salesPriceCents - costCents;
    } else {
      markupCents = Math.round(costCents * brand.attachmentMarkupPct);
      salesPriceCents = costCents + markupCents;
    }

    priced.push({
      attachmentId: null,
      description: custom.description,
      quantity: 1,
      listPriceCents: costCents, // no list price for custom items — cost is the floor
      discountCents: 0,
      costCents,
      markupPct: costCents > 0 ? markupCents / costCents : 0,
      markupCents,
      salesPriceCents,
      oemBranded: custom.oemBranded,
    });
  }

  const totalListCents = priced.reduce((s, a) => s + a.listPriceCents, 0);
  const totalCostCents = priced.reduce((s, a) => s + a.costCents, 0);
  const totalSalesPriceCents = priced.reduce((s, a) => s + a.salesPriceCents, 0);

  return {
    attachments: priced,
    subtotal: { totalListCents, totalCostCents, totalSalesPriceCents },
  };
}
