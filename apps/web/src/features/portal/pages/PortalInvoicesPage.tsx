import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";

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

export function PortalInvoicesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["portal", "invoices"],
    queryFn: portalApi.getInvoices,
    staleTime: 30_000,
  });

  return (
    <PortalLayout>
      <h1 className="text-xl font-bold text-foreground mb-4">Invoices & Payments</h1>

      {isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}</div>}

      <div className="space-y-2">
        {(data?.invoices ?? []).map((inv: any) => (
          <Card key={inv.id} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">#{inv.invoice_number}</p>
                <p className="text-xs text-muted-foreground">{inv.description || "Invoice"} • Due: {inv.due_date}</p>
              </div>
              <div className="text-right">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[inv.status] || ""}`}>{inv.status}</span>
                <p className="mt-1 text-sm font-bold text-foreground">{formatCurrency(inv.total)}</p>
                {inv.balance_due > 0 && (
                  <p className="text-xs text-red-400">Balance: {formatCurrency(inv.balance_due)}</p>
                )}
              </div>
            </div>
          </Card>
        ))}
        {!isLoading && (data?.invoices ?? []).length === 0 && (
          <Card className="border-dashed p-6 text-center"><p className="text-sm text-muted-foreground">No invoices.</p></Card>
        )}
      </div>
    </PortalLayout>
  );
}
