import { describe, expect, test } from "bun:test";
import { invoiceFilterDateValue, matchesPortalInvoiceFilters } from "./portal-invoice-history-utils";

const invoice = {
  invoice_number: "INV-1001",
  description: "Service invoice for loader PM",
  status: "overdue",
  due_date: "2026-05-01",
  invoice_date: "2026-04-20",
  updated_at: "2026-04-22T10:00:00.000Z",
  paid_at: null,
  payment_reference: "CHK-449",
  branch_id: "OCALA",
  customer_invoice_line_items: [{ description: "Loader service labor" }],
  portal_payment_history: [{ label: "Check received", detail: "Received by dealership", amount: 1200, status: "pending", created_at: "2026-04-22", resolved_at: null, reference: "CHK-449" }],
  portal_invoice_timeline: [{ label: "Invoice viewed", detail: "Customer opened the invoice.", at: "2026-04-22", tone: "blue" }],
};

describe("portal-invoice-history-utils", () => {
  test("picks the right date field", () => {
    expect(invoiceFilterDateValue(invoice, "invoice")).toBe("2026-04-20");
    expect(invoiceFilterDateValue(invoice, "due")).toBe("2026-05-01");
  });

  test("matches search against invoice, lines, and transcript", () => {
    expect(matchesPortalInvoiceFilters(invoice, { search: "INV-1001" })).toBe(true);
    expect(matchesPortalInvoiceFilters(invoice, { search: "loader service" })).toBe(true);
    expect(matchesPortalInvoiceFilters(invoice, { search: "CHK-449" })).toBe(true);
    expect(matchesPortalInvoiceFilters(invoice, { search: "does-not-exist" })).toBe(false);
  });

  test("applies status and date filters", () => {
    expect(matchesPortalInvoiceFilters(invoice, { status: "overdue", from: "2026-04-01", to: "2026-04-30" })).toBe(true);
    expect(matchesPortalInvoiceFilters(invoice, { status: "paid" })).toBe(false);
    expect(matchesPortalInvoiceFilters(invoice, { dateMode: "due", from: "2026-05-02" })).toBe(false);
  });
});
