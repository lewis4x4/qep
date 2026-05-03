import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { portalApi, type PortalBillingSummary, type PortalInvoiceTimelineItem, type PortalSubscriptionBillingDetail } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { PayInvoiceButton } from "../components/PayInvoiceButton";
import { downloadInvoiceStatement, type PortalInvoicePaymentHistoryItem } from "../lib/invoice-statement";
import { matchesPortalInvoiceFilters, type PortalInvoiceFilterDateMode } from "../lib/portal-invoice-history-utils";
import { AlertCircle, CheckCircle2, Download, Loader2, Search } from "lucide-react";

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

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && !Array.isArray(value) && "message" in value) {
    const message = value.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

type LineItem = {
  id?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
};

type PortalPaymentStatus = {
  label: string;
  tone: "blue" | "amber" | "emerald" | "red";
  detail: string;
  last_updated_at: string | null;
};

type InvoiceRecord = Record<string, unknown> & {
  portal_payment_status?: PortalPaymentStatus | null;
  portal_payment_history?: PortalInvoicePaymentHistoryItem[];
  portal_invoice_timeline?: PortalInvoiceTimelineItem[];
  portal_subscription_billing?: PortalSubscriptionBillingDetail | null;
  customer_invoice_line_items?: LineItem[];
};

function paymentToneStyles(tone: PortalPaymentStatus["tone"]): string {
  if (tone === "emerald") return "border-emerald-500/20 bg-emerald-500/5 text-emerald-400";
  if (tone === "red") return "border-red-500/20 bg-red-500/5 text-red-400";
  if (tone === "blue") return "border-blue-500/20 bg-blue-500/5 text-blue-400";
  return "border-amber-500/20 bg-amber-500/5 text-amber-400";
}

function PaymentStatusIcon({ tone }: { tone: PortalPaymentStatus["tone"] }) {
  if (tone === "emerald") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (tone === "red") return <AlertCircle className="h-3.5 w-3.5" />;
  return <Loader2 className="h-3.5 w-3.5" />;
}

function formatHistoryDate(value: string | null): string {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function PortalInvoicesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateMode, setDateMode] = useState<PortalInvoiceFilterDateMode>("invoice");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showOfflineForm, setShowOfflineForm] = useState<Record<string, boolean>>({});
  const [payAmount, setPayAmount] = useState<Record<string, string>>({});
  const [payMethod, setPayMethod] = useState<Record<string, string>>({});
  const [payRef, setPayRef] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["portal", "invoices", search, statusFilter, dateMode, dateFrom, dateTo],
    queryFn: () => portalApi.getInvoices({
      search: search.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      dateMode,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    }),
    staleTime: 30_000,
  });

  const payMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.recordInvoicePayment(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal", "invoices"] }),
  });

  const billingSummary = data?.billing_summary as PortalBillingSummary | undefined;
  const invoices = useMemo(
    () =>
      (data?.invoices ?? []).filter((invoice) =>
        matchesPortalInvoiceFilters(invoice as InvoiceRecord, {
          search,
          status: statusFilter,
          dateMode,
          from: dateFrom || undefined,
          to: dateTo || undefined,
        }),
      ),
    [data?.invoices, dateFrom, dateMode, dateTo, search, statusFilter],
  );

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Invoices & Payments</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Pay open invoices online when Stripe is available. If you already paid by check, ACH, or another offline method, record that below so the dealership can reconcile it.
      </p>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice #, branch, line item, or payment ref"
              className="pl-9"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="viewed">Viewed</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
          </select>
          <select value={dateMode} onChange={(e) => setDateMode(e.target.value as PortalInvoiceFilterDateMode)} className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm">
            <option value="invoice">Invoice Date</option>
            <option value="due">Due Date</option>
            <option value="updated">Processed Date</option>
            <option value="paid">Paid Date</option>
          </select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </Card>

      {billingSummary && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Open balance</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{formatCurrency(billingSummary.open_balance)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Overdue balance</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{formatCurrency(billingSummary.overdue_balance)}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Subscription charges</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{billingSummary.subscription_invoices}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Payments in flight</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{billingSummary.payments_in_flight}</p>
          </Card>
        </div>
      )}

      {isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}</div>}

      <div className="space-y-2">
        {invoices.map((inv) => {
          const invoice = inv as InvoiceRecord;
          const balance = Number(inv.balance_due ?? 0);
          const lines = invoice.customer_invoice_line_items ?? [];
          const invoiceId = String(inv.id);
          const companyId = typeof inv.crm_company_id === "string" ? inv.crm_company_id : "";
          const paymentStatus = invoice.portal_payment_status ?? null;
          const paymentHistory = invoice.portal_payment_history ?? [];
          const billingTimeline = invoice.portal_invoice_timeline ?? [];
          const subscriptionBilling = invoice.portal_subscription_billing ?? null;
          const offlineOpen = showOfflineForm[invoiceId] === true;
          return (
            <Card key={invoiceId} className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <Link to={`/portal/invoices/${invoiceId}`} className="text-sm font-semibold text-foreground hover:text-primary">
                    #{String(inv.invoice_number)}
                  </Link>
                  <p className="text-xs text-muted-foreground">{String(inv.description || "Invoice")} • Due: {String(inv.due_date)}</p>
                  {typeof inv.branch_id === "string" && inv.branch_id ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">Location: {inv.branch_id}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[String(inv.status)] || ""}`}>{String(inv.status)}</span>
                  <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(Number(inv.total))}</p>
                  {balance > 0 && (
                    <p className="text-xs text-red-400">Balance: {formatCurrency(balance)}</p>
                  )}
                </div>
              </div>
              {subscriptionBilling && (
                <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                  <p className="text-xs font-semibold text-blue-400">{subscriptionBilling.plan_name}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Billing period {new Date(subscriptionBilling.billing_period_start).toLocaleDateString()} to {new Date(subscriptionBilling.billing_period_end).toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Usage {subscriptionBilling.used_hours ?? "—"} hrs
                    {subscriptionBilling.included_hours != null ? ` / included ${subscriptionBilling.included_hours} hrs` : ""}
                    {subscriptionBilling.overage_hours != null ? ` · overage ${subscriptionBilling.overage_hours} hrs` : ""}
                    {subscriptionBilling.overage_charge != null ? ` · ${formatCurrency(subscriptionBilling.overage_charge)} overage` : ""}
                  </p>
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => downloadInvoiceStatement({
                    invoice_number: String(inv.invoice_number ?? invoiceId),
                    invoice_date: typeof inv.invoice_date === "string" ? inv.invoice_date : null,
                    due_date: typeof inv.due_date === "string" ? inv.due_date : null,
                    description: typeof inv.description === "string" ? inv.description : null,
                    status: typeof inv.status === "string" ? inv.status : null,
                    total: Number(inv.total ?? 0),
                    amount_paid: Number(inv.amount_paid ?? 0),
                    balance_due: balance,
                    payment_method: typeof inv.payment_method === "string" ? inv.payment_method : null,
                    payment_reference: typeof inv.payment_reference === "string" ? inv.payment_reference : null,
                    customer_invoice_line_items: lines,
                    portal_payment_history: paymentHistory,
                  })}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download statement
                </Button>
              </div>
              {paymentStatus && (
                <div className={`rounded-md border px-3 py-2 ${paymentToneStyles(paymentStatus.tone)}`}>
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <PaymentStatusIcon tone={paymentStatus.tone} />
                    <span>{paymentStatus.label}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{paymentStatus.detail}</p>
                  {paymentStatus.last_updated_at && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Last updated: {new Date(paymentStatus.last_updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </p>
                  )}
                </div>
              )}
              {paymentHistory.length > 0 && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-foreground">Payment history</p>
                      <p className="text-[11px] text-muted-foreground">
                        Stripe attempts and dealership-recorded payments appear here.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {paymentHistory.map((entry) => (
                      <div key={`${entry.label}-${entry.created_at}-${entry.reference ?? "none"}`} className="rounded-md border border-border/50 bg-background/60 px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-foreground">{entry.label}</p>
                            <p className="text-[11px] text-muted-foreground">{entry.detail}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-semibold text-foreground">{formatCurrency(entry.amount)}</p>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{entry.status}</p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                          <span>Started {formatHistoryDate(entry.created_at)}</span>
                          {entry.resolved_at ? <span>Resolved {formatHistoryDate(entry.resolved_at)}</span> : null}
                          {entry.reference ? <span>Ref {entry.reference}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {billingTimeline.length > 0 && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs font-semibold text-foreground">Billing timeline</p>
                  <div className="mt-3 space-y-2">
                    {billingTimeline.map((entry, index) => (
                      <div key={`${entry.label}-${index}`} className="flex items-start gap-3">
                        <div className={`mt-1 h-2.5 w-2.5 rounded-full ${
                          entry.tone === "emerald" ? "bg-emerald-400" :
                          entry.tone === "red" ? "bg-red-400" :
                          entry.tone === "amber" ? "bg-amber-400" : "bg-blue-400"
                        }`} />
                        <div>
                          <p className="text-xs font-semibold text-foreground">{entry.label}</p>
                          <p className="text-[11px] text-muted-foreground">{entry.detail}</p>
                          {entry.at ? <p className="text-[10px] text-muted-foreground">{formatHistoryDate(entry.at)}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
        {!isLoading && invoices.length === 0 && (
          <Card className="border-dashed p-6 text-center"><p className="text-sm text-muted-foreground">No invoices.</p></Card>
        )}
      </div>
      {payMutation.isError && (
        <p className="text-sm text-destructive mt-2">{errorMessage(payMutation.error, "Payment update failed")}</p>
      )}
    </PortalLayout>
  );
}
