import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { listCrmWeightedOpenDeals } from "../lib/qrm-deals-api";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildRevenueRescueBoard } from "../lib/revenue-rescue";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, StatusDot, SignalChip } from "../components/command-deck";
import { useQuoteVelocity } from "../command-center/hooks/useQuoteVelocity";
import { useBlockers } from "../command-center/hooks/useBlockers";
import { computeQuoteVelocity } from "../command-center/lib/quoteVelocity";
import { groupBlockedDeals } from "../command-center/lib/blockerTypes";
import { supabase } from "@/lib/supabase";

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

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

  const { summary } = board;

  // Cascading Iron briefing — route to the sharpest rescue lever.
  const rescueIronHeadline = isLoading
    ? "Fusing weighted pipeline, blockers, quote pressure, and time burn…"
    : isError
      ? "Revenue rescue offline — one of the feeders failed. Check the console."
      : summary.blockedCount > 0
        ? `${summary.blockedCount} candidate${summary.blockedCount === 1 ? "" : "s"} blocked — unblock first to reopen ${fmtMoney(summary.saveableWeightedRevenue)} of saveable weighted revenue. ${summary.overTimeCount} time-burn · ${summary.quoteAtRiskCount} quote-risk.`
        : summary.overTimeCount > 0
          ? `${summary.overTimeCount} candidate${summary.overTimeCount === 1 ? "" : "s"} burning stage time with ${fmtMoney(summary.saveableWeightedRevenue)} still saveable — reset the clock before the week slips.`
          : summary.quoteAtRiskCount > 0
            ? `${summary.quoteAtRiskCount} quote${summary.quoteAtRiskCount === 1 ? "" : "s"} decaying — push or redraft before signals go cold. ${fmtMoney(summary.saveableWeightedRevenue)} still saveable.`
            : summary.candidateCount > 0
              ? `${summary.candidateCount} rescue candidate${summary.candidateCount === 1 ? "" : "s"} in scope, ${fmtMoney(summary.saveableWeightedRevenue)} saveable. No blockers — pressure the stage that's weakest.`
              : "No active rescue pressure. Pipeline is flowing — press new motion.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Revenue Rescue"
        subtitle="Weighted revenue still saveable this week — triaged by blockers, quote pressure, and stage-time burn."
        crumb={{ surface: "TODAY", lens: "RESCUE", count: summary.candidateCount }}
        metrics={[
          { label: "Candidates", value: summary.candidateCount, tone: summary.candidateCount > 0 ? "active" : undefined },
          { label: "Saveable", value: fmtMoney(summary.saveableWeightedRevenue), tone: summary.saveableWeightedRevenue > 0 ? "live" : undefined },
          { label: "Blocked", value: summary.blockedCount, tone: summary.blockedCount > 0 ? "hot" : undefined },
          { label: "Time burn", value: summary.overTimeCount, tone: summary.overTimeCount > 0 ? "warm" : undefined },
          { label: "Quote risk", value: summary.quoteAtRiskCount, tone: summary.quoteAtRiskCount > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: rescueIronHeadline,
          actions: [
            { label: "Blockers →", href: "/qrm/command/blockers" },
            { label: "Ops Copilot →", href: "/qrm/operations-copilot" },
          ],
        }}
      />
      <QrmSubNav />

      {isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading revenue rescue…</DeckSurface>
      ) : isError ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          Revenue rescue is unavailable right now.
        </DeckSurface>
      ) : (
        <DeckSurface className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Rescue queue</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Prioritized by weighted pipeline × urgency of blockers, quote decay, and stage-time overrun.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]">
              <Link to="/qrm/command/quotes">
                Quotes <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
          <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
            {board.candidates.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No rescue candidates are active right now.</p>
            ) : (
              board.candidates.slice(0, 12).map((item) => {
                const tone = item.priorityScore >= 70 ? "hot" : item.priorityScore >= 40 ? "warm" : "active";
                return (
                  <div key={item.dealId} className="flex flex-col gap-2 px-3 py-2.5 transition-colors hover:bg-qep-orange/[0.04] lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-2">
                      <StatusDot tone={tone} pulse={tone === "hot"} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-medium text-foreground">{item.dealName}</p>
                          <SignalChip label="Priority" value={item.priorityScore} tone={tone} />
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {formatCurrency(item.weightedAmount)} weighted · {formatCurrency(item.amount)} open
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{item.reasons.join(" · ")}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 lg:shrink-0">
                      {item.companyId ? (
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                          <Link to={buildAccountCommandHref(item.companyId)}>
                            Account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      ) : null}
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                        <Link to={`/qrm/deals/${item.dealId}/room`}>
                          Room <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground">
                        <Link to={`/qrm/deals/${item.dealId}`}>
                          Detail <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DeckSurface>
      )}
    </div>
  );
}
