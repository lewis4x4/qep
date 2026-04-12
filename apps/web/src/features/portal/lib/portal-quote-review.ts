export interface PortalQuoteReviewLineItem {
  description: string;
  quantity: number | null;
  amount: number | null;
}

export interface PortalQuoteReviewSummary {
  headline: string | null;
  notes: string[];
  terms: string[];
  lineItems: PortalQuoteReviewLineItem[];
  equipmentLabels: string[];
  financingHighlights: string[];
  subtotal: number | null;
  tradeAllowance: number | null;
  netTotal: number | null;
  dealerMessage: string | null;
  revisionSummary: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTextList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLineItems(value: unknown): PortalQuoteReviewLineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      description:
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : typeof item.name === "string" && item.name.trim()
            ? item.name.trim()
            : "Quote item",
      quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
      amount: Number.isFinite(Number(item.amount ?? item.total ?? item.line_total))
        ? Number(item.amount ?? item.total ?? item.line_total)
        : null,
    }));
}

export function summarizePortalQuoteReview(quoteData: unknown): PortalQuoteReviewSummary {
  const data = asRecord(quoteData);
  if (!data) {
    return {
      headline: null,
      notes: [],
      terms: [],
      lineItems: [],
      equipmentLabels: [],
      financingHighlights: [],
      subtotal: null,
      tradeAllowance: null,
      netTotal: null,
      dealerMessage: null,
      revisionSummary: null,
    };
  }

  const headline = typeof data.summary === "string" && data.summary.trim()
    ? data.summary.trim()
    : typeof data.headline === "string" && data.headline.trim()
      ? data.headline.trim()
      : typeof data.description === "string" && data.description.trim()
        ? data.description.trim()
        : null;

  return {
    headline,
    notes: [
      ...asTextList(data.notes),
      ...asTextList(data.customer_notes),
    ],
    terms: [
      ...asTextList(data.terms),
      ...asTextList(data.legal_terms),
    ],
    lineItems: normalizeLineItems(data.line_items ?? data.items),
    equipmentLabels: Array.isArray(data.equipment)
      ? data.equipment
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => [item.make, item.model, item.year].filter(Boolean).join(" ").trim())
        .filter(Boolean)
      : [],
    financingHighlights: Array.isArray(data.financing)
      ? data.financing
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => {
          const parts = [
            typeof item.type === "string" ? item.type.toUpperCase() : null,
            Number.isFinite(Number(item.monthlyPayment)) ? `$${Math.round(Number(item.monthlyPayment)).toLocaleString()}/mo` : null,
            Number.isFinite(Number(item.termMonths)) ? `${Math.round(Number(item.termMonths))} mo` : null,
          ].filter(Boolean);
          return parts.join(" · ");
        })
        .filter(Boolean)
      : [],
    subtotal: Number.isFinite(Number(data.subtotal)) ? Number(data.subtotal) : null,
    tradeAllowance: Number.isFinite(Number(data.tradeAllowance ?? data.trade_allowance))
      ? Number(data.tradeAllowance ?? data.trade_allowance)
      : null,
    netTotal: Number.isFinite(Number(data.netTotal ?? data.net_total)) ? Number(data.netTotal ?? data.net_total) : null,
    dealerMessage: typeof data.dealer_message === "string" && data.dealer_message.trim()
      ? data.dealer_message.trim()
      : typeof data.dealerMessage === "string" && data.dealerMessage.trim()
        ? data.dealerMessage.trim()
        : null,
    revisionSummary: typeof data.revision_summary === "string" && data.revision_summary.trim()
      ? data.revision_summary.trim()
      : typeof data.revisionSummary === "string" && data.revisionSummary.trim()
        ? data.revisionSummary.trim()
        : null,
  };
}
