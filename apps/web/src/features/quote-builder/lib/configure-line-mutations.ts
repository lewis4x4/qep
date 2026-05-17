import type { QuoteLineItemDraft } from "../../../../../../shared/qep-moonshot-contracts";

import type { QuotePackageCatalogKind } from "./quote-api";

export interface ConfigLineInput {
  id?: string;
  title: string;
  unitPrice: number;
}

export function buildConfigAttachmentLine(
  kind: QuotePackageCatalogKind,
  input?: ConfigLineInput,
  idSuffix: number = Date.now(),
): QuoteLineItemDraft {
  const title = input?.title?.trim() || `${kind[0]!.toUpperCase()}${kind.slice(1)} line`;
  return {
    kind,
    id: input?.id ?? `${kind}-${idSuffix}`,
    sourceCatalog: input?.id ? "qb_attachments" : "manual",
    sourceId: input?.id ?? null,
    dealerCost: null,
    title,
    quantity: 1,
    unitPrice: input?.unitPrice ?? 0,
  };
}

export function mergeConfigAttachment(
  attachments: QuoteLineItemDraft[],
  line: QuoteLineItemDraft,
): QuoteLineItemDraft[] {
  return attachments.some((item) => item.id === line.id)
    ? attachments
    : [...attachments, line];
}
