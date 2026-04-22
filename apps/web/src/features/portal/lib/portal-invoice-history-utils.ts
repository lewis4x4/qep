import type { PortalInvoiceTimelineItem } from "./portal-api";
import type { PortalInvoicePaymentHistoryItem } from "./invoice-statement";

export type PortalInvoiceFilterDateMode = "invoice" | "due" | "updated" | "paid";

export type PortalInvoiceFilterInput = {
  search?: string;
  status?: string;
  dateMode?: PortalInvoiceFilterDateMode;
  from?: string;
  to?: string;
};

export type PortalInvoiceHistoryRecord = Record<string, unknown> & {
  invoice_number?: string | null;
  description?: string | null;
  status?: string | null;
  due_date?: string | null;
  invoice_date?: string | null;
  updated_at?: string | null;
  paid_at?: string | null;
  payment_reference?: string | null;
  branch_id?: string | null;
  customer_invoice_line_items?: Array<{ description?: string | null }> | null;
  portal_payment_history?: PortalInvoicePaymentHistoryItem[];
  portal_invoice_timeline?: PortalInvoiceTimelineItem[];
};

export function invoiceFilterDateValue(
  invoice: PortalInvoiceHistoryRecord,
  mode: PortalInvoiceFilterDateMode,
): string | null {
  switch (mode) {
    case "due":
      return typeof invoice.due_date === "string" ? invoice.due_date : null;
    case "updated":
      return typeof invoice.updated_at === "string" ? invoice.updated_at : null;
    case "paid":
      return typeof invoice.paid_at === "string" ? invoice.paid_at : null;
    default:
      return typeof invoice.invoice_date === "string" ? invoice.invoice_date : null;
  }
}

export function matchesPortalInvoiceFilters(
  invoice: PortalInvoiceHistoryRecord,
  filters: PortalInvoiceFilterInput,
): boolean {
  const statusFilter = filters.status?.trim();
  if (statusFilter && statusFilter !== "all" && invoice.status !== statusFilter) return false;

  const dateMode = filters.dateMode ?? "invoice";
  const dateValue = invoiceFilterDateValue(invoice, dateMode);
  if (filters.from && (!dateValue || dateValue < filters.from)) return false;
  if (filters.to && (!dateValue || dateValue > filters.to)) return false;

  const needle = filters.search?.trim().toLowerCase();
  if (!needle) return true;

  const lineDescriptions = (invoice.customer_invoice_line_items ?? [])
    .map((line) => line.description ?? "")
    .join(" ");
  const paymentRefs = (invoice.portal_payment_history ?? [])
    .map((entry) => entry.reference ?? "")
    .join(" ");
  const timelineDetails = (invoice.portal_invoice_timeline ?? [])
    .map((entry) => `${entry.label} ${entry.detail}`)
    .join(" ");

  const haystack = [
    invoice.invoice_number,
    invoice.description,
    invoice.payment_reference,
    invoice.branch_id,
    lineDescriptions,
    paymentRefs,
    timelineDetails,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}
