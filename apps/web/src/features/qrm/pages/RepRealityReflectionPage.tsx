import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Eye, Mic, Timer, TrendingUp, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { buildRepRealityBoard } from "../lib/rep-reality";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { crmSupabase } from "../lib/qrm-supabase";
import type { TimeBankRow } from "../lib/time-bank";

export function RepRealityReflectionPage() {
  const { profile } = useAuth();

  const boardQuery = useQuery({
    queryKey: ["qrm", "rep-reality", profile?.id],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const [dealsResult, timeBankResult, voiceResult, activityResult, companiesResult] = await Promise.all([
        supabase
          .from("crm_deals_weighted")
          .select("id, name, company_id, weighted_amount, next_follow_up_at, last_activity_at")
          .eq("assigned_rep_id", profile!.id)
          .is("closed_at", null)
          .limit(300),
        crmSupabase.rpc("qrm_time_bank", {
          p_workspace_id: profile?.active_workspace_id ?? "default",
          p_default_budget_days: 14,
        }),
        supabase
          .from("voice_captures")
          .select("id")
          .eq("user_id", profile!.id)
          .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .limit(200),
        supabase
          .from("crm_activities")
          .select("id")
          .eq("created_by", profile!.id)
          .gte("occurred_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
          .limit(500),
        supabase
          .from("crm_companies")
          .select("id, name")
          .limit(500),
      ]);

      if (dealsResult.error) throw new Error(dealsResult.error.message);
      if (timeBankResult.error) throw new Error(timeBankResult.error.message ?? "Failed to load Time Bank.");
      if (companiesResult.error) throw new Error(companiesResult.error.message);

      const companyNameById = new Map((companiesResult.data ?? []).map((row) => [row.id, row.name]));
      const timeBankRows = (timeBankResult.data ?? []) satisfies TimeBankRow[];
      const timeBankByDeal = new Map(timeBankRows.map((row) => [row.deal_id, row]));

      return {
        deals: (dealsResult.data ?? []).map((row) => ({
          dealId: row.id,
          dealName: row.name,
          companyName: row.company_id ? (companyNameById.get(row.company_id) ?? "Account") : "Account",
          weightedAmount: row.weighted_amount ?? 0,
          nextFollowUpAt: row.next_follow_up_at,
          lastActivityAt: row.last_activity_at,
          pctUsed: timeBankByDeal.get(row.id)?.pct_used ?? null,
          isOver: Boolean(timeBankByDeal.get(row.id)?.is_over),
        })),
        voiceNotes30d: (voiceResult.data?.length ?? 0),
        touches7d: (activityResult.data?.length ?? 0),
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = useMemo(
    () => (boardQuery.data ? buildRepRealityBoard(boardQuery.data) : null),
    [boardQuery.data],
  );
  const isLoading = boardQuery.isLoading;
  const isError = boardQuery.isError;

  if (!profile?.id) {
    return (
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">Profile required.</p>
        </DeckSurface>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Rep Reality Reflection"
        subtitle="Private to you. A rep-owned mirror of your pipeline hygiene, focus risk, and signal discipline."
      />
      <QrmSubNav />

      {isLoading ? (
        <div className="space-y-3">
          <DeckSurface className="h-8 bg-muted/20 rounded-sm animate-pulse"><div className="h-full" /></DeckSurface>
          <DeckSurface className="h-8 bg-muted/20 rounded-sm animate-pulse"><div className="h-full" /></DeckSurface>
        </div>
      ) : isError || !board ? (
        <div className="space-y-3">
          <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
            <div>
            <p className="text-sm text-muted-foreground">
              {boardQuery.error instanceof Error ? boardQuery.error.message : "Your reflection is unavailable right now."}
            </p>
            </div>
          </DeckSurface>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pipeline</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(board.summary.weightedRevenue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Weighted opportunity value across all open deals.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Time Bank</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.overTimeDeals)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Deals currently over their stage time budget.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Mic className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Voice Notes</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.voiceNotes30d)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Voice captures captured in last 30 days.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Overdue Follow-ups</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.overdueFollowUps)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Open deals that already missed their next follow-up date.</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Your deals</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open deals weighted by opportunity value and signal discipline. Sort by overdue follow-ups and time bank usage.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/qrm/deals">
                  Open all deals <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="space-y-3">
              {board.focusDeals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No deals assigned to you yet.</p>
              ) : (
                board.focusDeals.slice(0, 10).map((deal) => (
                  <DeckSurface key={deal.dealId} className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{deal.companyName}</p>
                        </div>
                        <div className="mt-3 space-y-1">
                          <p className="text-sm text-muted-foreground">{deal.dealName}</p>
                          <div className="flex items-center gap-4">
                            <p className="text-sm text-foreground">{formatCurrency(deal.weightedAmount)}</p>
                            <div className="text-xs text-muted-foreground">
                              {deal.nextFollowUpAt ? (
                                <p className="mt-1">
                                  Follow-up due {new Date(deal.nextFollowUpAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </p>
                              ) : null}
                              {deal.lastActivityAt ? (
                                <p className="mt-1">
                                  Last activity {new Date(deal.lastActivityAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </p>
                              ) : null}
                              {deal.pctUsed != null && (
                                <span className={`text-xs font-medium ${deal.pctUsed > 1.0 ? "text-qep-warm" : "text-muted-foreground"}`}>
                                  {deal.pctUsed} of budget used
                                </span>
                              )}
                              {deal.isOver && (
                                <span className="text-xs font-medium text-qep-warm">
                                  Over budget
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/qrm/deals/${deal.dealId}`}>
                              Open deal <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </DeckSurface>
                ))
              )}
            </div>
          </DeckSurface>
        </>
      )}
    </div>
  );
}
