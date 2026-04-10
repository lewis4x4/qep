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
  };
}
