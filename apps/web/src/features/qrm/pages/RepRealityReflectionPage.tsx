import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Eye, Mic, Timer, TrendingUp, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { buildRepRealityBoard } from "../lib/rep-reality";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

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
        (supabase as unknown as {
          rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
        }).rpc("qrm_time_bank", {
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
      if (timeBankResult.error) throw new Error(timeBankResult.error.message ?? "Failed to load time bank.");
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (activityResult.error) throw new Error(activityResult.error.message);
      if (companiesResult.error) throw new Error(companiesResult.error.message);

      const companyNameById = new Map((companiesResult.data ?? []).map((row) => [row.id, row.name]));
      const timeBankByDeal = new Map(
        ((timeBankResult.data ?? []) as Array<{ deal_id: string; pct_used: number; is_over: boolean }>).map((row) => [row.deal_id, row]),
      );

      return buildRepRealityBoard({
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
        voiceNotes30d: voiceResult.data?.length ?? 0,
        touches7d: activityResult.data?.length ?? 0,
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Rep Reality Reflection"
        subtitle="Private to you. A rep-owned mirror of your pipeline hygiene, focus risk, and signal discipline."
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading your reflection…</Card>
      ) : boardQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Your reflection is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <SummaryCard icon={Eye} label="Active Deals" value={String(board.summary.activeDeals)} />
            <SummaryCard icon={TrendingUp} label="Weighted Revenue" value={formatCurrency(board.summary.weightedRevenue)} />
            <SummaryCard icon={Timer} label="Overdue Follow-Ups" value={String(board.summary.overdueFollowUps)} tone={board.summary.overdueFollowUps > 0 ? "warn" : "default"} />
            <SummaryCard icon={Timer} label="Over-Time Deals" value={String(board.summary.overTimeDeals)} tone={board.summary.overTimeDeals > 0 ? "warn" : "default"} />
            <SummaryCard icon={Mic} label="Voice Notes 30d" value={String(board.summary.voiceNotes30d)} />
          </div>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Reality check</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {board.insights.map((insight) => (
                <span
                  key={insight.label}
                  className={`rounded-full px-2 py-1 text-[11px] ${
                    insight.tone === "warn"
                      ? "bg-amber-500/10 text-amber-200"
                      : insight.tone === "good"
                        ? "bg-emerald-500/10 text-emerald-200"
                        : "bg-white/5 text-muted-foreground"
                  }`}
                >
                  {insight.label}
                </span>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Focus deals</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ordered by what most needs your attention first.
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/qrm/deals">
                    Pipeline <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/voice-qrm">
                    Voice QRM <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {board.focusDeals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active deals are assigned to you right now.</p>
              ) : (
                board.focusDeals.slice(0, 12).map((deal) => (
                  <div key={deal.dealId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{deal.dealName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {deal.companyName} · {formatCurrency(deal.weightedAmount)}
                          {deal.isOver ? " · over time budget" : ""}
                          {deal.pctUsed != null ? ` · ${Math.round(deal.pctUsed * 100)}% time used` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/qrm/deals/${deal.dealId}`}>
                            Deal <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/qrm/deals/${deal.dealId}/room`}>
                            Room <ArrowUpRight className="ml-1 h-3 w-3" />
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
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className={`mt-3 text-2xl font-semibold ${tone === "warn" ? "text-amber-400" : "text-foreground"}`}>{value}</p>
    </Card>
  );
}
