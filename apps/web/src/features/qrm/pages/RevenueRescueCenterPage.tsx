import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, LifeBuoy, Timer, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { listCrmWeightedOpenDeals } from "../lib/qrm-deals-api";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildRevenueRescueBoard } from "../lib/revenue-rescue";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { useQuoteVelocity } from "../command-center/hooks/useQuoteVelocity";
import { useBlockers } from "../command-center/hooks/useBlockers";
import { computeQuoteVelocity } from "../command-center/lib/quoteVelocity";
import { groupBlockedDeals } from "../command-center/lib/blockerTypes";
import { supabase } from "@/lib/supabase";

export function RevenueRescueCenterPage() {
  const workspaceQuery = useMyWorkspaceId();
  const workspaceId = workspaceQuery.data ?? "default";
  const dealsQuery = useQuery({
    queryKey: ["revenue-rescue", "deals"],
    queryFn: () => listCrmWeightedOpenDeals(),
    staleTime: 60_000,
  });
  const quoteVelocity = useQuoteVelocity();
  const blockersQuery = useBlockers();
  const timeBankQuery = useQuery({
    queryKey: ["revenue-rescue", "time-bank", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
      }).rpc("qrm_time_bank", {
        p_workspace_id: workspaceId,
        p_default_budget_days: 14,
      });
      if (error) throw new Error(error.message ?? "Failed to load time bank.");
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const board = useMemo(() => {
    const quoteRows = quoteVelocity.data
      ? computeQuoteVelocity(quoteVelocity.data.packages, quoteVelocity.data.signatures, Date.now()).rows
      : [];
    const blockerRows = blockersQuery.data
      ? groupBlockedDeals(blockersQuery.data.deals, blockersQuery.data.deposits, blockersQuery.data.anomalies).groups.flatMap((group) => group.deals)
      : [];
    return buildRevenueRescueBoard({
      deals: dealsQuery.data ?? [],
      timeBankRows: (timeBankQuery.data ?? []) as Parameters<typeof buildRevenueRescueBoard>[0]["timeBankRows"],
      quoteRows,
      blockedDeals: blockerRows,
    });
  }, [blockersQuery.data, dealsQuery.data, quoteVelocity.data, timeBankQuery.data]);

  const isLoading = dealsQuery.isLoading || quoteVelocity.isLoading || blockersQuery.isLoading || timeBankQuery.isLoading;
  const isError = dealsQuery.isError || quoteVelocity.isError || blockersQuery.isError || timeBankQuery.isError;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Revenue Rescue Center"
        subtitle="Weighted revenue that is still saveable this week, triaged by blockers, quote pressure, and stage-time burn."
      />
      <QrmSubNav />

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading revenue rescue…</Card>
      ) : isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          Revenue rescue is unavailable right now.
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={LifeBuoy} label="Candidates" value={String(board.summary.candidateCount)} detail="Deals with active rescue pressure." />
            <SummaryCard icon={TrendingUp} label="Saveable" value={formatCurrency(board.summary.saveableWeightedRevenue)} detail="Weighted revenue currently recoverable." />
            <SummaryCard icon={AlertTriangle} label="Blocked" value={String(board.summary.blockedCount)} detail="Candidates with deposit, margin, or anomaly blockers." tone={board.summary.blockedCount > 0 ? "warn" : "default"} />
            <SummaryCard icon={Timer} label="Time Burn" value={String(board.summary.overTimeCount)} detail={`${board.summary.quoteAtRiskCount} quote-risk candidates`} tone={board.summary.overTimeCount > 0 ? "warn" : "default"} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Rescue queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Prioritized from weighted pipeline value plus the urgency of blockers, quote decay, and stage-time overrun.
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/qrm/command/blockers">
                    Blockers <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/qrm/command/quotes">
                    Quotes <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {board.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rescue candidates are active right now.</p>
              ) : (
                board.candidates.slice(0, 12).map((item) => (
                  <div key={item.dealId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{item.dealName}</p>
                          <PriorityPill score={item.priorityScore} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatCurrency(item.weightedAmount)} weighted of {formatCurrency(item.amount)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.reasons.join(" · ")}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {item.companyId ? (
                          <Button asChild size="sm" variant="ghost">
                            <Link to={buildAccountCommandHref(item.companyId)}>
                              Account <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        ) : null}
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/qrm/deals/${item.dealId}/room`}>
                            Deal Room <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/qrm/deals/${item.dealId}`}>
                            Detail <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
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
      <p className={`mt-3 text-2xl font-semibold ${tone === "warn" ? "text-amber-400" : "text-foreground"}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function PriorityPill({ score }: { score: number }) {
  const tone = score >= 70
    ? "bg-red-500/10 text-red-300"
    : score >= 40
      ? "bg-amber-500/10 text-amber-200"
      : "bg-emerald-500/10 text-emerald-200";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      Priority {score}
    </span>
  );
}
