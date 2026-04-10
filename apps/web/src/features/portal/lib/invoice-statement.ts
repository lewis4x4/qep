export interface PortalInvoiceStatementLine {
  description?: string;
  quantity?: number;
  line_total?: number;
}

export interface PortalInvoicePaymentHistoryItem {
  label: string;
  detail: string;
  amount: number;
  status: "pending" | "processing" | "paid" | "failed";
  created_at: string;
  resolved_at: string | null;
  reference: string | null;
}

export interface PortalInvoiceStatementInput {
  invoice_number: string;
  invoice_date?: string | null;
  due_date?: string | null;
  description?: string | null;
  status?: string | null;
  total?: number | null;
  amount_paid?: number | null;
  balance_due?: number | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  customer_invoice_line_items?: PortalInvoiceStatementLine[];
  portal_payment_history?: PortalInvoicePaymentHistoryItem[];
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function invoiceStatementFilename(invoiceNumber: string): string {
  return `invoice-${invoiceNumber.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "statement"}.md`;
}

export function buildInvoiceStatementMarkdown(input: PortalInvoiceStatementInput): string {
  const lines = input.customer_invoice_line_items ?? [];
  const paymentHistory = input.portal_payment_history ?? [];

  const lineTable = lines.length > 0
    ? [
      "| Description | Qty | Total |",
      "| --- | ---: | ---: |",
      ...lines.map((line) =>
        `| ${line.description ?? "Item"} | ${Number(line.quantity ?? 0)} | ${formatCurrency(line.line_total ?? 0)} |`
      ),
    ].join("\n")
    : "_No line items attached._";

  const historySection = paymentHistory.length > 0
    ? paymentHistory.map((entry) =>
      `- ${formatDate(entry.created_at)} · ${entry.label} · ${formatCurrency(entry.amount)} · ${entry.detail}${entry.reference ? ` (ref: ${entry.reference})` : ""}`
    ).join("\n")
    : "- No recorded payment activity yet.";

  return [
    `# Invoice Statement ${input.invoice_number}`,
    "",
    `- Invoice date: ${formatDate(input.invoice_date)}`,
    `- Due date: ${formatDate(input.due_date)}`,
    `- Status: ${input.status ?? "pending"}`,
    `- Description: ${input.description ?? "Invoice"}`,
    `- Total: ${formatCurrency(input.total)}`,
    `- Amount paid: ${formatCurrency(input.amount_paid)}`,
    `- Balance due: ${formatCurrency(input.balance_due)}`,
    `- Payment method: ${input.payment_method ?? "—"}`,
    `- Payment reference: ${input.payment_reference ?? "—"}`,
    "",
    "## Line Items",
    "",
    lineTable,
    "",
    "## Payment History",
    "",
    historySection,
    "",
  ].join("\n");
}

export function downloadInvoiceStatement(input: PortalInvoiceStatementInput): void {
  const blob = new Blob([buildInvoiceStatementMarkdown(input)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = invoiceStatementFilename(input.invoice_number);
  anchor.click();
  URL.revokeObjectURL(url);
}
