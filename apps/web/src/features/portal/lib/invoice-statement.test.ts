import { describe, expect, test } from "bun:test";
import { buildInvoiceStatementMarkdown, invoiceStatementFilename } from "./invoice-statement";

describe("invoice-statement helpers", () => {
  test("sanitizes a stable markdown filename", () => {
    expect(invoiceStatementFilename("INV 204/7")).toBe("invoice-inv-204-7.md");
  });

  test("renders a statement with line items and payment history", () => {
    const markdown = buildInvoiceStatementMarkdown({
      invoice_number: "INV-2047",
      invoice_date: "2026-04-10",
      due_date: "2026-04-25",
      description: "Service visit",
      status: "partial",
      total: 220.5,
      amount_paid: 120.5,
      balance_due: 100,
      payment_method: "stripe",
      payment_reference: "stripe:pi_123",
      customer_invoice_line_items: [
        { description: "Inspection", quantity: 1, line_total: 120.5 },
        { description: "Hydraulic fitting", quantity: 2, line_total: 100 },
      ],
      portal_payment_history: [
        {
          label: "Card payment received",
          detail: "Stripe verified the payment and the invoice was reconciled.",
          amount: 120.5,
          status: "paid",
          created_at: "2026-04-10T12:00:00Z",
          resolved_at: "2026-04-10T12:05:00Z",
          reference: "pi_123",
        },
      ],
    });

    expect(markdown).toContain("# Invoice Statement INV-2047");
    expect(markdown).toContain("| Inspection | 1 | $120.50 |");
    expect(markdown).toContain("Card payment received");
    expect(markdown).toContain("Balance due: $100.00");
  });
});
