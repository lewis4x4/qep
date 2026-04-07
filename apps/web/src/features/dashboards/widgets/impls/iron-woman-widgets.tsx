/**
 * Iron Woman widget impls — order processing, deposits, intake, credit apps.
 *
 * All read from useIronWomanData and share the same React Query cache.
 */
import { Link } from "react-router-dom";
import { Widget } from "../Widget";
import { useIronWomanData } from "../../hooks/useDashboardData";
import { Package, DollarSign, Boxes, CreditCard } from "lucide-react";

function dealStageName(deal: {
  crm_deal_stages?: { name?: string | null } | { name?: string | null }[] | null;
}): string {
  const s = deal.crm_deal_stages;
  if (!s) return "—";
  if (Array.isArray(s)) return s[0]?.name?.trim() || "—";
  return s.name?.trim() || "—";
}

export function OrderProcessingWidget() {
  const { data, isLoading, isError } = useIronWomanData();
  const items = data?.orderProcessing ?? [];
  return (
    <Widget
      title="Order processing"
      description="Sales order signed through deposit collected (steps 13–16)."
      icon={<Package className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load orders." : null}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deals in this stage band.</p>
      ) : (
        <div className="space-y-2">
          {items.map((deal: any) => (
            <Link
              key={deal.id}
              to={`/crm/deals/${deal.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 transition hover:border-foreground/20"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{deal.name}</p>
                <p className="text-[10px] text-muted-foreground">{dealStageName(deal)}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {deal.amount != null ? `$${Number(deal.amount).toLocaleString()}` : "—"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}

export function DepositTrackerWidget() {
  const { data, isLoading, isError } = useIronWomanData();
  const items = data?.pendingDeposits ?? [];
  return (
    <Widget
      title="Deposit tracker"
      description="Deposits requested, pending, or just received."
      icon={<DollarSign className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load deposits." : null}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending deposits.</p>
      ) : (
        <div className="space-y-2">
          {items.map((dep: any) => (
            <Link
              key={dep.id}
              to={`/crm/deals/${dep.deal_id}`}
              className="flex items-center justify-between rounded-lg border border-border p-2.5 transition hover:border-foreground/20"
            >
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  dep.status === "received"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : dep.status === "requested"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {dep.status}
              </span>
              <span className="font-semibold text-foreground">
                {dep.required_amount != null
                  ? `$${Number(dep.required_amount).toLocaleString()}`
                  : "—"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}

export function IntakeProgressWidget() {
  const { data, isLoading, isError } = useIronWomanData();
  const items = data?.intakeItems ?? [];
  return (
    <Widget
      title="Equipment intake progress"
      description="Stock numbers in process through stage 8."
      icon={<Boxes className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load intake." : null}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No equipment in intake pipeline.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item: any) => (
            <Link
              key={item.id}
              to="/ops/intake"
              className="flex items-center justify-between rounded-lg border border-border p-2.5 transition hover:border-foreground/20"
            >
              <span className="text-sm font-medium">{item.stock_number || "No stock #"}</span>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-2 w-4 rounded-sm ${
                        i < item.current_stage ? "bg-qep-orange" : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {item.current_stage}/8
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}

export function CreditAppsWidget() {
  const { data, isLoading, isError } = useIronWomanData();
  const items = data?.creditApps ?? [];
  return (
    <Widget
      title="Credit applications"
      description="Deals in credit-submitted stage awaiting bank status."
      icon={<CreditCard className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load credit apps." : null}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deals in credit review.</p>
      ) : (
        <div className="space-y-2">
          {items.map((deal: any) => (
            <Link
              key={deal.id}
              to={`/crm/deals/${deal.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 transition hover:border-foreground/20"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{deal.name}</p>
                <p className="text-[10px] text-muted-foreground">{dealStageName(deal)}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {deal.amount != null ? `$${Number(deal.amount).toLocaleString()}` : "—"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}
