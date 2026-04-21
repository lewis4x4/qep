import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { usePartsAnalytics } from "@/features/parts/hooks/usePartsAnalytics";
import { usePredictiveKits } from "@/features/parts/hooks/usePredictiveKits";
import { useDemandForecast } from "@/features/parts/hooks/useDemandForecast";
import { useInventoryHealth } from "@/features/parts/hooks/useInventoryHealth";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildPartsIntelligenceBoard } from "../lib/parts-intelligence";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, SignalChip, StatusDot, type StatusTone } from "../components/command-deck";

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

function riskTone(risk: string): StatusTone {
  const r = risk.toLowerCase();
  if (r.includes("high") || r.includes("critical")) return "hot";
  if (r.includes("medium") || r.includes("watch")) return "warm";
  if (r.includes("low")) return "ok";
  return "active";
}

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

  const suggested = kitsQuery.data?.suggestedCount ?? 0;
  const ready = kitsQuery.data?.allInStockCount ?? 0;
  const partial = kitsQuery.data?.partialCount ?? 0;
  const watch = forecastQuery.data?.watchCount ?? 0;

  // Cascading Iron briefing — route to the sharpest parts lever.
  const partsIronHeadline = isLoading
    ? "Fusing analytics, predictive kits, demand forecast, and inventory health…"
    : isError
      ? "Parts Intelligence offline — one of the feeders failed. Check the console."
      : board.summary.criticalForecasts > 0
        ? `${board.summary.criticalForecasts} critical forecast row${board.summary.criticalForecasts === 1 ? "" : "s"} — stage coverage before the next service sweep. ${board.summary.inventoryRisks} inventory risk${board.summary.inventoryRisks === 1 ? "" : "s"} · ${ready} ready kits.`
        : board.summary.inventoryRisks > 0
          ? `${board.summary.inventoryRisks} inventory risk row${board.summary.inventoryRisks === 1 ? "" : "s"} — rebalance before the demand wave lands. ${ready} ready kits on the shelf.`
          : ready > 0
            ? `${ready} predictive kit${ready === 1 ? "" : "s"} fully ready to stage — pull forward a service visit and convert the parts basket.`
            : board.summary.topAccounts > 0
              ? `${board.summary.topAccounts} demand account${board.summary.topAccounts === 1 ? "" : "s"} live. No acute pressure — work the consultative basket.`
              : "No parts demand signals yet. Feed the analytics or prime a predictive kit.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Parts Intelligence"
        subtitle="Purchasing patterns, predictive kits, and forecast pressure translated into live demand signals."
        crumb={{ surface: "PULSE", lens: "PARTS", count: board.summary.topAccounts }}
        metrics={[
          { label: "Accounts", value: board.summary.topAccounts, tone: board.summary.topAccounts > 0 ? "active" : undefined },
          { label: "Kits", value: board.summary.predictiveKits, tone: board.summary.predictiveKits > 0 ? "live" : undefined },
          { label: "Critical", value: board.summary.criticalForecasts, tone: board.summary.criticalForecasts > 0 ? "hot" : undefined },
          { label: "Risk rows", value: board.summary.inventoryRisks, tone: board.summary.inventoryRisks > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: partsIronHeadline,
          actions: [
            { label: "Analytics →", href: "/parts/analytics" },
            { label: "Inventory →", href: "/parts/inventory" },
          ],
        }}
      />
      <QrmSubNav />

      {isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading parts intelligence…</DeckSurface>
      ) : isError ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          Parts intelligence is unavailable right now.
        </DeckSurface>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
          <DeckSurface className="p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Account demand signals</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Accounts whose purchase patterns and predicted kits are most useful for commercial action.
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]">
                <Link to="/parts/analytics">
                  Analytics <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
              {board.accountSignals.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No demand accounts are surfaced yet.</p>
              ) : (
                board.accountSignals.slice(0, 10).map((account) => {
                  const tone: StatusTone = account.readyKitCount > 0 ? "live" : account.predictiveKitCount > 0 ? "active" : "cool";
                  return (
                    <Link
                      key={account.companyId}
                      to={buildAccountCommandHref(account.companyId)}
                      className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-qep-orange/[0.04]"
                    >
                      <StatusDot tone={tone} pulse={false} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{account.companyName}</p>
                        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {formatCurrency(account.annualRevenue)}/12m · {account.orderCount} orders
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {account.predictiveKitCount} kits · {account.readyKitCount} ready
                          {account.totalKitValue > 0 ? ` · ${fmtMoney(account.totalKitValue)} kit value` : ""}
                        </p>
                      </div>
                      <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-qep-orange" />
                    </Link>
                  );
                })
              )}
            </div>
          </DeckSurface>

          <div className="flex flex-col gap-3">
            <DeckSurface className="p-3 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Demand pressure</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Forecasted parts demand that is likely to outrun current coverage. {watch > 0 ? `${watch} watch rows.` : ""}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline" className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]">
                  <Link to="/parts/inventory">
                    Inventory <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
                {board.demandSignals.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No forecast pressure is active right now.</p>
                ) : (
                  board.demandSignals.slice(0, 8).map((signal) => {
                    const tone = riskTone(signal.demandRisk);
                    return (
                      <div key={`${signal.partNumber}:${signal.branchId}`} className="flex items-start gap-3 px-3 py-2.5">
                        <StatusDot tone={tone} pulse={tone === "hot"} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[13px] font-medium text-foreground">{signal.partNumber}</p>
                            <SignalChip label={`${signal.demandRisk} risk`} tone={tone} />
                          </div>
                          <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                            {signal.branchId} · {signal.coverageStatus.replace(/_/g, " ")} · qty {signal.predictedQty}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </DeckSurface>

            <DeckSurface className="p-3 sm:p-4">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Predictive kit posture</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Kits already suggested by the parts engine and how many can be staged immediately.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <KitMetric label="Suggested" value={suggested} tone="active" />
                <KitMetric label="Ready" value={ready} tone="live" />
                <KitMetric label="Partial" value={partial} tone={partial > 0 ? "warm" : "cool"} />
              </div>
            </DeckSurface>
          </div>
        </div>
      )}
    </div>
  );
}

function KitMetric({ label, value, tone }: { label: string; value: number; tone: StatusTone }) {
  return (
    <div className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} pulse={tone === "live"} />
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
