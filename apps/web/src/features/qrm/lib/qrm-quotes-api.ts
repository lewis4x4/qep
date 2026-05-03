import { crmSupabase, type QrmDatabase } from "./qrm-supabase";
import type { QrmQuote, QrmQuoteUpsertInput } from "./types";

const QUOTE_SELECT =
  "id, workspace_id, created_by, crm_contact_id, crm_deal_id, status, title, line_items, customer_snapshot, metadata, linked_at, created_at, updated_at, deleted_at";

type QuoteInsert = QrmDatabase["public"]["Tables"]["quotes"]["Insert"];
type QuoteUpdate = QrmDatabase["public"]["Tables"]["quotes"]["Update"];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeQuoteStatus(value: unknown): QrmQuote["status"] {
  return value === "draft" || value === "linked" || value === "archived" ? value : "draft";
}

export function normalizeQuoteRows(rows: unknown): QrmQuote[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      workspaceId: requiredString(row.workspace_id, "default"),
      createdBy: nullableString(row.created_by),
      crmContactId: nullableString(row.crm_contact_id),
      crmDealId: nullableString(row.crm_deal_id),
      status: normalizeQuoteStatus(row.status),
      title: nullableString(row.title),
      lineItems: asArray(row.line_items),
      customerSnapshot: asRecord(row.customer_snapshot),
      metadata: asRecord(row.metadata),
      linkedAt: nullableString(row.linked_at),
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
      deletedAt: nullableString(row.deleted_at),
    }];
  });
}

function toInsertPayload(input: QrmQuoteUpsertInput): QuoteInsert {
  return {
    crm_contact_id: input.crmContactId ?? null,
    crm_deal_id: input.crmDealId ?? null,
    status: input.status,
    title: input.title ?? null,
    line_items: input.lineItems as QuoteInsert["line_items"],
    customer_snapshot: input.customerSnapshot as QuoteInsert["customer_snapshot"],
    metadata: (input.metadata ?? {}) as QuoteInsert["metadata"],
    linked_at: input.linkedAt ?? (input.status === "linked" ? new Date().toISOString() : null),
  };
}

function toUpdatePayload(input: QrmQuoteUpsertInput): QuoteUpdate {
  return {
    crm_contact_id: input.crmContactId ?? null,
    crm_deal_id: input.crmDealId ?? null,
    status: input.status,
    title: input.title ?? null,
    line_items: input.lineItems as QuoteUpdate["line_items"],
    customer_snapshot: input.customerSnapshot as QuoteUpdate["customer_snapshot"],
    metadata: (input.metadata ?? {}) as QuoteUpdate["metadata"],
    linked_at: input.linkedAt ?? (input.status === "linked" ? new Date().toISOString() : null),
  };
}

export async function createCrmQuote(input: QrmQuoteUpsertInput): Promise<QrmQuote> {
  const { data, error } = await crmSupabase
    .from("quotes")
    .insert(toInsertPayload(input))
    .select(QUOTE_SELECT)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const quote = normalizeQuoteRows([data])[0];
  if (!quote) {
    throw new Error("Quote response was malformed.");
  }
  return quote;
}

export async function updateCrmQuote(quoteId: string, input: QrmQuoteUpsertInput): Promise<QrmQuote> {
  const { data, error } = await crmSupabase
    .from("quotes")
    .update(toUpdatePayload(input))
    .eq("id", quoteId)
    .is("deleted_at", null)
    .select(QUOTE_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Quote not found or inaccessible.");
  }

  const quote = normalizeQuoteRows([data])[0];
  if (!quote) {
    throw new Error("Quote response was malformed.");
  }
  return quote;
}

export async function listCrmQuotesForContact(contactId: string): Promise<QrmQuote[]> {
  const { data, error } = await crmSupabase
    .from("quotes")
    .select(QUOTE_SELECT)
    .eq("crm_contact_id", contactId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(error.message);
  }

  return normalizeQuoteRows(data);
}

export async function listCrmQuotesForDeal(dealId: string): Promise<QrmQuote[]> {
  const { data, error } = await crmSupabase
    .from("quotes")
    .select(QUOTE_SELECT)
    .eq("crm_deal_id", dealId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(error.message);
  }

  return normalizeQuoteRows(data);
}
