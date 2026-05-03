export interface DealQuoteSummary {
  id: string;
  status: string | null;
  quote_number: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  expires_at: string | null;
  net_total: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeDealQuoteRows(rows: unknown): DealQuoteSummary[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    const createdAt = requiredString(row.created_at, "");
    return [{
      id: row.id,
      status: nullableString(row.status),
      quote_number: nullableString(row.quote_number),
      created_at: createdAt,
      updated_at: requiredString(row.updated_at, createdAt),
      sent_at: nullableString(row.sent_at),
      expires_at: nullableString(row.expires_at),
      net_total: nullableNumber(row.net_total),
    }];
  });
}
