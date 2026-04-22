import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi } from "../lib/portal-api";
import { downloadInvoiceStatement, type PortalInvoicePaymentHistoryItem } from "../lib/invoice-statement";

type LineItem = {
  id?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
};

type InvoiceRecord = Record<string, unknown> & {
  customer_invoice_line_items?: LineItem[];
  portal_payment_history?: PortalInvoicePaymentHistoryItem[];
  portal_invoice_timeline?: Array<{ label: string; detail: string; at: string | null; tone: string }>;
};

function money(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

function niceDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function PortalInvoiceDetailPage() {
  const { invoiceId = "" } = useParams<{ invoiceId: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["portal", "invoice", invoiceId],
    queryFn: () => portalApi.getInvoice(invoiceId),
    enabled: invoiceId.length > 0,
    staleTime: 30_000,
  });

  const invoice = useMemo(() => (data?.invoice ?? null) as InvoiceRecord | null, [data?.invoice]);
  const lines = invoice?.customer_invoice_line_items ?? [];
  const history = invoice?.portal_payment_history ?? [];
  const timeline = invoice?.portal_invoice_timeline ?? [];

  return (
    <PortalLayout>
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="h-7 text-[11px]">
          <Link to="/portal/invoices">
            <ArrowLeft className="mr-1 h-3 w-3" />
            Back to invoice history
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <Card className="h-40 animate-pulse" />
      ) : !invoice ? (
        <Card className="border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">Invoice not found.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Invoice detail</p>
                <h1 className="mt-1 text-xl font-bold text-foreground">#{String(invoice.invoice_number ?? invoiceId)}</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {String(invoice.description ?? "Invoice")} · Status {String(invoice.status ?? "pending")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadInvoiceStatement({
                    invoice_number: String(invoice.invoice_number ?? invoiceId),
                    invoice_date: typeof invoice.invoice_date === "string" ? invoice.invoice_date : null,
                    due_date: typeof invoice.due_date === "string" ? invoice.due_date : null,
                    description: typeof invoice.description === "string" ? invoice.description : null,
                    status: typeof invoice.status === "string" ? invoice.status : null,
                    total: Number(invoice.total ?? 0),
                    amount_paid: Number(invoice.amount_paid ?? 0),
                    balance_due: Number(invoice.balance_due ?? 0),
                    payment_method: typeof invoice.payment_method === "string" ? invoice.payment_method : null,
                    payment_reference: typeof invoice.payment_reference === "string" ? invoice.payment_reference : null,
                    customer_invoice_line_items: lines,
                    portal_payment_history: history,
                  })
                }
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                Statement
              </Button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Metric label="Invoice Date" value={niceDate(typeof invoice.invoice_date === "string" ? invoice.invoice_date : null)} />
              <Metric label="Due Date" value={niceDate(typeof invoice.due_date === "string" ? invoice.due_date : null)} />
              <Metric label="Total" value={money(Number(invoice.total ?? 0))} />
              <Metric label="Balance" value={money(Number(invoice.balance_due ?? 0))} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-foreground">Line items</h2>
            <div className="mt-3 overflow-x-auto rounded border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id ?? `${line.description}-${line.line_total}`} className="border-t border-border/40">
                      <td className="px-3 py-2">{line.description}</td>
                      <td className="px-3 py-2 text-right">{line.quantity ?? 0}</td>
                      <td className="px-3 py-2 text-right">{money(Number(line.unit_price ?? 0))}</td>
                      <td className="px-3 py-2 text-right">{money(Number(line.line_total ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground">Payment transcript</h2>
              <div className="mt-3 space-y-2">
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No payment activity recorded.</p>
                ) : history.map((entry) => (
                  <div key={`${entry.label}-${entry.created_at}-${entry.reference ?? "none"}`} className="rounded border border-border/50 bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-foreground">{entry.label}</p>
                        <p className="text-[11px] text-muted-foreground">{entry.detail}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {niceDate(entry.created_at)}{entry.reference ? ` · Ref ${entry.reference}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-foreground">{money(entry.amount)}</p>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{entry.status}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground">Billing timeline</h2>
              <div className="mt-3 space-y-2">
                {timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No billing events recorded.</p>
                ) : timeline.map((entry, index) => (
                  <div key={`${entry.label}-${index}`} className="rounded border border-border/50 bg-muted/20 p-3">
                    <p className="text-xs font-semibold text-foreground">{entry.label}</p>
                    <p className="text-[11px] text-muted-foreground">{entry.detail}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{niceDate(entry.at)}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
