import { crmSupabase, type CrmDatabase } from "./crm-supabase";
import type { CrmQuote, CrmQuoteUpsertInput } from "./types";

const QUOTE_SELECT =
  "id, workspace_id, created_by, crm_contact_id, crm_deal_id, status, title, line_items, customer_snapshot, metadata, linked_at, created_at, updated_at, deleted_at";

type QuoteRow = CrmDatabase["public"]["Tables"]["quotes"]["Row"];

type QuoteInsert = CrmDatabase["public"]["Tables"]["quotes"]["Insert"];
type QuoteUpdate = CrmDatabase["public"]["Tables"]["quotes"]["Update"];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toQuote(row: QuoteRow): CrmQuote {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    crmContactId: row.crm_contact_id,
    crmDealId: row.crm_deal_id,
    status: row.status,
    title: row.title,
    lineItems: asArray(row.line_items),
    customerSnapshot: asRecord(row.customer_snapshot),
    metadata: asRecord(row.metadata),
    linkedAt: row.linked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toInsertPayload(input: CrmQuoteUpsertInput): QuoteInsert {
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

function toUpdatePayload(input: CrmQuoteUpsertInput): QuoteUpdate {
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

export async function createCrmQuote(input: CrmQuoteUpsertInput): Promise<CrmQuote> {
  const { data, error } = await crmSupabase
    .from("quotes")
    .insert(toInsertPayload(input))
    .select(QUOTE_SELECT)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return toQuote(data as QuoteRow);
}

export async function updateCrmQuote(quoteId: string, input: CrmQuoteUpsertInput): Promise<CrmQuote> {
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

  return toQuote(data as QuoteRow);
}

export async function listCrmQuotesForContact(contactId: string): Promise<CrmQuote[]> {
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

  return ((data ?? []) as QuoteRow[]).map(toQuote);
}

export async function listCrmQuotesForDeal(dealId: string): Promise<CrmQuote[]> {
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

  return ((data ?? []) as QuoteRow[]).map(toQuote);
}
