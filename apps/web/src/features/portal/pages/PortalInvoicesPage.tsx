import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { PayInvoiceButton } from "../components/PayInvoiceButton";

function formatCurrency(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  sent: "bg-blue-500/10 text-blue-400",
  viewed: "bg-violet-500/10 text-violet-400",
  paid: "bg-emerald-500/10 text-emerald-400",
  overdue: "bg-red-500/10 text-red-400",
  partial: "bg-cyan-500/10 text-cyan-400",
};

type LineItem = {
  id?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
};

export function PortalInvoicesPage() {
  const qc = useQueryClient();
  const [showOfflineForm, setShowOfflineForm] = useState<Record<string, boolean>>({});
  const [payAmount, setPayAmount] = useState<Record<string, string>>({});
  const [payMethod, setPayMethod] = useState<Record<string, string>>({});
  const [payRef, setPayRef] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["portal", "invoices"],
    queryFn: portalApi.getInvoices,
    staleTime: 30_000,
  });

  const payMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.recordInvoicePayment(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal", "invoices"] }),
  });

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Invoices & Payments</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Pay open invoices online when Stripe is available. If you already paid by check, ACH, or another offline method, record that below so the dealership can reconcile it.
      </p>

      {isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}</div>}

      <div className="space-y-2">
        {(data?.invoices ?? []).map((inv: Record<string, unknown>) => {
          const balance = Number(inv.balance_due ?? 0);
          const lines = (inv.customer_invoice_line_items as LineItem[] | undefined) ?? [];
          const invoiceId = String(inv.id);
          const companyId = typeof inv.crm_company_id === "string" ? inv.crm_company_id : "";
          const offlineOpen = showOfflineForm[invoiceId] === true;
          return (
            <Card key={invoiceId} className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-foreground">#{String(inv.invoice_number)}</p>
                  <p className="text-xs text-muted-foreground">{String(inv.description || "Invoice")} • Due: {String(inv.due_date)}</p>
                </div>
                <div className="text-right">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[String(inv.status)] || ""}`}>{String(inv.status)}</span>
                  <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(Number(inv.total))}</p>
                  {balance > 0 && (
                    <p className="text-xs text-red-400">Balance: {formatCurrency(balance)}</p>
                  )}
                </div>
              </div>
              {lines.length > 0 && (
                <div className="rounded border border-border/60 text-xs overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-2 py-1 font-medium">Description</th>
                        <th className="px-2 py-1 font-medium text-right">Qty</th>
                        <th className="px-2 py-1 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((li) => (
                        <tr key={li.id ?? `${li.description}-${li.line_total}`} className="border-t border-border/40">
                          <td className="px-2 py-1">{li.description}</td>
                          <td className="px-2 py-1 text-right">{li.quantity}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(Number(li.line_total ?? 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {balance > 0 && (
                <div className="space-y-3 pt-1 border-t border-dashed">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-foreground">Pay online</p>
                      <p className="text-[11px] text-muted-foreground">
                        Secure checkout opens in a new tab. If card payments are unavailable, we fall back to a payment-coordination email.
                      </p>
                    </div>
                    {companyId ? (
                      <PayInvoiceButton
                        invoiceId={invoiceId}
                        companyId={companyId}
                        amountCents={Math.round(balance * 100)}
                        description={`Invoice ${String(inv.invoice_number)}`}
                      />
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Online payment is unavailable for this invoice.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowOfflineForm((current) => ({
                        ...current,
                        [invoiceId]: !current[invoiceId],
                      }))}
                    >
                      {offlineOpen ? "Hide offline payment form" : "Already paid another way?"}
                    </Button>
                  </div>

                  {offlineOpen && (
                    <div className="flex flex-col sm:flex-row gap-2 items-end flex-wrap">
                      <div className="flex-1 min-w-[100px]">
                        <label className="text-[10px] text-muted-foreground">Amount</label>
                        <Input
                          type="number"
                          step="0.01"
                          min={0.01}
                          max={balance}
                          value={payAmount[invoiceId] ?? ""}
                          onChange={(e) => setPayAmount((m) => ({ ...m, [invoiceId]: e.target.value }))}
                          placeholder={String(balance)}
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="flex-1 min-w-[120px]">
                        <label className="text-[10px] text-muted-foreground">Method</label>
                        <Input
                          value={payMethod[invoiceId] ?? ""}
                          onChange={(e) => setPayMethod((m) => ({ ...m, [invoiceId]: e.target.value }))}
                          placeholder="ach / check / card"
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="flex-1 min-w-[140px]">
                        <label className="text-[10px] text-muted-foreground">Reference #</label>
                        <Input
                          value={payRef[invoiceId] ?? ""}
                          onChange={(e) => setPayRef((m) => ({ ...m, [invoiceId]: e.target.value }))}
                          placeholder="Confirmation / check #"
                          className="h-9 text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={payMutation.isPending}
                        onClick={() => {
                          const amt = Number(payAmount[invoiceId] ?? balance);
                          if (!Number.isFinite(amt) || amt <= 0 || amt > balance) return;
                          payMutation.mutate({
                            invoice_id: inv.id,
                            amount: amt,
                            payment_method: payMethod[invoiceId] || null,
                            payment_reference: payRef[invoiceId] || null,
                          });
                        }}
                      >
                        {payMutation.isPending ? "Recording…" : "Record offline payment"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {!isLoading && (data?.invoices ?? []).length === 0 && (
          <Card className="border-dashed p-6 text-center"><p className="text-sm text-muted-foreground">No invoices.</p></Card>
        )}
      </div>
      {payMutation.isError && (
        <p className="text-sm text-destructive mt-2">{(payMutation.error as Error).message}</p>
      )}
    </PortalLayout>
  );
}
