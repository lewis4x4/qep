import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, DoorClosed, RotateCcw, Skull } from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { buildExitRegisterBoard } from "../lib/exit-register";

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
  }
}

function stateTone(state: "churn_risk" | "lost" | "won_back"): string {
  switch (state) {
    case "lost":
      return "text-red-300";
    case "churn_risk":
      return "text-amber-300";
    default:
      return "text-emerald-300";
  }
}

function stateLabel(state: "churn_risk" | "lost" | "won_back"): string {
  switch (state) {
    case "lost":
      return "Lost";
    case "churn_risk":
      return "Churn Risk";
    default:
      return "Won Back";
  }
}

export function ExitRegisterPage() {
  const boardQuery = useQuery({
    queryKey: ["qrm", "exit-register"],
    queryFn: async () => {
      const [lifecycleResult, lostDealsResult] = await Promise.all([
        supabase
          .from("customer_lifecycle_events")
          .select("company_id, event_type, event_at, source_table, crm_companies(name)")
          .in("event_type", ["churn_risk_flag", "lost", "won_back"])
          .order("event_at", { ascending: false })
          .limit(500),
        supabase
          .from("crm_deals")
          .select("id, name, company_id, loss_reason, competitor, closed_at, crm_deal_stages!inner(is_closed_lost), crm_companies(name)")
          .eq("crm_deal_stages.is_closed_lost", true)
          .not("closed_at", "is", null)
          .gte("closed_at", new Date(Date.now() - 365 * 86_400_000).toISOString())
          .limit(500),
      ]);

      if (lifecycleResult.error) throw new Error(lifecycleResult.error.message);
      if (lostDealsResult.error) throw new Error(lostDealsResult.error.message);

      return buildExitRegisterBoard({
        lifecycleSignals: (lifecycleResult.data ?? []).map((row) => {
          const companyJoin = Array.isArray(row.crm_companies) ? row.crm_companies[0] : row.crm_companies;
          return {
            companyId: row.company_id,
            companyName: companyJoin?.name ?? null,
            eventType: row.event_type,
            eventAt: row.event_at,
            sourceTable: row.source_table,
          };
        }),
        lostDeals: (lostDealsResult.data ?? []).map((row) => {
          const companyJoin = Array.isArray(row.crm_companies) ? row.crm_companies[0] : row.crm_companies;
          return {
            companyId: row.company_id,
            companyName: companyJoin?.name ?? null,
            dealId: row.id,
            dealName: row.name,
            closedAt: row.closed_at,
            lossReason: row.loss_reason,
            competitor: row.competitor,
          };
        }),
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data;

  const headline = useMemo(() => {
    if (!board) return "End-of-relationship events across the book.";
    if (board.summary.lost > 0) {
      return "Accounts that are lost, drifting toward exit, or have already been won back.";
    }
    return "No active exit markers are visible right now.";
  }, [board]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Death and Exit Register"
        subtitle={headline}
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center text-sm text-muted-foreground">
          Loading death and exit register…
        </DeckSurface>
      ) : boardQuery.isError || !board ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error
            ? boardQuery.error.message
            : "Death and exit register is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={DoorClosed} label="Accounts" value={String(board.summary.accounts)} />
            <SummaryCard
              icon={AlertTriangle}
              label="Churn Risk"
              value={String(board.summary.churnRisk)}
              tone={board.summary.churnRisk > 0 ? "warn" : "default"}
            />
            <SummaryCard
              icon={Skull}
              label="Lost"
              value={String(board.summary.lost)}
              tone={board.summary.lost > 0 ? "warn" : "default"}
            />
            <SummaryCard icon={RotateCcw} label="Won Back" value={String(board.summary.wonBack)} />
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Exit rows</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ordered by latest end-of-relationship severity first, with direct drill paths to the existing timeline and account command routes.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/qrm/companies">
                  Accounts <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {board.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No end-of-relationship markers are active right now.
                </p>
              ) : (
                board.rows.map((row) => (
                  <div key={row.companyId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{row.companyName}</p>
                          <span className={`text-[11px] font-medium ${stateTone(row.state)}`}>
                            {stateLabel(row.state)}
                          </span>
                          <span className={`text-[11px] font-medium ${confidenceTone(row.confidence)}`}>
                            {row.confidence} confidence
                          </span>
                        </div>
                        <div className="mt-3 space-y-1">
                          {row.trace.map((line) => (
                            <p key={line} className="text-xs text-muted-foreground">
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button asChild size="sm" variant="outline">
                          <Link to={row.primaryHref}>
                            Timeline <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={row.secondaryHref}>
                            Account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DeckSurface>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <DeckSurface className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </DeckSurface>
  );
}
