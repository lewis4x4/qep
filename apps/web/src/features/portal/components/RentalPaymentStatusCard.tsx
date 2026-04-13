import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PayInvoiceButton } from "./PayInvoiceButton";
import type { PortalRentalPaymentStatusView } from "../../../../../../shared/qep-moonshot-contracts";

function toneClasses(status: PortalRentalPaymentStatusView["status"]): string {
  if (status === "paid") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (status === "failed") return "border-red-400/30 bg-red-500/10 text-red-100";
  if (status === "processing") return "border-blue-400/30 bg-blue-500/10 text-blue-100";
  if (status === "pending") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  return "border-white/10 bg-white/[0.03] text-white/80";
}

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function RentalPaymentStatusCard({
  payment,
  description,
  finalizeLabel,
  finalizePending,
  onFinalize,
}: {
  payment: PortalRentalPaymentStatusView | null;
  description: string;
  finalizeLabel: string;
  finalizePending: boolean;
  onFinalize: () => void;
}) {
  if (!payment) return null;

  return (
    <Card className={`mt-4 border p-4 shadow-none ${toneClasses(payment.status)}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">
            {payment.kind === "deposit" ? "Rental deposit status" : "Extension payment status"}
          </p>
          <p className="mt-2 text-base font-semibold">{payment.headline}</p>
          <p className="mt-2 text-sm opacity-85">{payment.detail}</p>
          <p className="mt-2 text-xs opacity-70">
            {description} · Amount {formatCurrency(payment.amount)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {payment.canPayNow && payment.invoiceId && payment.companyId && (payment.amount ?? 0) > 0 ? (
            <PayInvoiceButton
              invoiceId={payment.invoiceId}
              companyId={payment.companyId}
              amountCents={Math.round((payment.amount ?? 0) * 100)}
              description={description}
            />
          ) : null}
          {payment.canFinalize ? (
            <Button variant="outline" onClick={onFinalize} disabled={finalizePending}>
              {finalizePending ? "Checking payment..." : finalizeLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
