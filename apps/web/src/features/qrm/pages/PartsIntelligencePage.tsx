import { Link } from "react-router-dom";
import { usePartsAnalytics } from "@/features/parts/hooks/usePartsAnalytics";
import { usePredictiveKits } from "@/features/parts/hooks/usePredictiveKits";
import { useDemandForecast } from "@/features/parts/hooks/useDemandForecast";
import { useInventoryHealth } from "@/features/parts/hooks/useInventoryHealth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, TrendingUp, Warehouse, Wrench, ArrowUpRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildPartsIntelligenceBoard } from "../lib/parts-intelligence";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

export function PartsIntelligencePage() {
  const analyticsQuery = usePartsAnalytics();
  const kitsQuery = usePredictiveKits();
  const forecastQuery = useDemandForecast();
  const inventoryHealthQuery = useInventoryHealth();

  const isLoading = analyticsQuery.isLoading || kitsQuery.isLoading || forecastQuery.isLoading || inventoryHealthQuery.isLoading;
  const isError = analyticsQuery.isError || kitsQuery.isError || forecastQuery.isError || inventoryHealthQuery.isError;

  const board = buildPartsIntelligenceBoard({
    topCustomers: analyticsQuery.data?.top_customers ?? [],
    kits: kitsQuery.data?.kits ?? [],
    forecastRows: forecastQuery.data?.rows ?? [],
    inventoryRisks: inventoryHealthQuery.data?.rows ?? [],
  });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Parts Intelligence"
        subtitle="Purchasing patterns, predictive kits, and forecast pressure translated into live demand signals."
      />
      <QrmSubNav />

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading parts intelligence…</Card>
      ) : isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          Parts intelligence is unavailable right now.
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={TrendingUp} label="Demand accounts" value={String(board.summary.topAccounts)} detail="Top buying accounts carrying parts signals." />
            <SummaryCard icon={Package} label="Predictive kits" value={String(board.summary.predictiveKits)} detail={`${kitsQuery.data?.allInStockCount ?? 0} fully ready to stage`} />
            <SummaryCard icon={Warehouse} label="Critical forecast" value={String(board.summary.criticalForecasts)} detail={`${forecastQuery.data?.watchCount ?? 0} additional watch rows`} tone={board.summary.criticalForecasts > 0 ? "warn" : "default"} />
            <SummaryCard icon={Wrench} label="Inventory risk" value={String(board.summary.inventoryRisks)} detail={`${inventoryHealthQuery.data?.mode === "intelligent" ? "reorder intelligence" : "static threshold"} view`} tone={board.summary.inventoryRisks > 0 ? "warn" : "default"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Account demand signals</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The accounts whose purchase patterns and predicted kits are most useful for commercial action.
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/parts/analytics">
                    Parts analytics <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {board.accountSignals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No demand accounts are surfaced yet.</p>
                ) : (
                  board.accountSignals.slice(0, 10).map((account) => (
                    <div key={account.companyId} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{account.companyName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            12m spend {formatCurrency(account.annualRevenue)} · {account.orderCount} orders
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {account.predictiveKitCount} predictive kits · {account.readyKitCount} ready to stage
                            {account.totalKitValue > 0 ? ` · ${formatCurrency(account.totalKitValue)} kit value` : ""}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={buildAccountCommandHref(account.companyId)}>
                            Account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Demand pressure</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Forecasted parts demand that is likely to outrun current coverage.
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/parts/inventory">
                      Inventory <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
                <div className="mt-4 space-y-3">
                  {board.demandSignals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No forecast pressure is active right now.</p>
                  ) : (
                    board.demandSignals.slice(0, 8).map((signal) => (
                      <div key={`${signal.partNumber}:${signal.branchId}`} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                        <p className="text-sm font-medium text-foreground">{signal.partNumber}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {signal.branchId} · {signal.demandRisk} risk · {signal.coverageStatus.replace(/_/g, " ")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Predicted qty {signal.predictedQty}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <Card className="p-4">
                <h2 className="text-sm font-semibold text-foreground">Predictive kit posture</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Kits already suggested by the parts engine and how many can be staged immediately.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MetricBlock label="Suggested" value={String(kitsQuery.data?.suggestedCount ?? 0)} />
                  <MetricBlock label="Ready" value={String(kitsQuery.data?.allInStockCount ?? 0)} tone="good" />
                  <MetricBlock label="Partial" value={String(kitsQuery.data?.partialCount ?? 0)} tone="warn" />
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function MetricBlock({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  const toneClass = tone === "good"
    ? "text-emerald-400"
    : tone === "warn"
      ? "text-amber-400"
      : "text-foreground";

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
