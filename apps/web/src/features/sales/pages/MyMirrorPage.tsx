/**
 * WAVE phase 4 — Sales rep's private My Mirror surface inside SalesShell.
 *
 * Mirrors the data fetched by features/qrm/pages/RepRealityReflectionPage.tsx
 * (and reuses `buildRepRealityBoard`), but renders with the mobile-first
 * primitives — MobileKpiGrid for the four headline metrics, single-column
 * deal cards, and tap-to-open links into /sales/deals/:dealId (Phase 5).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Eye, Mic, Timer, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/format";
import { buildRepRealityBoard } from "@/features/qrm/lib/rep-reality";
import { fetchTimeBankRows } from "@/features/qrm/lib/time-bank-api";
import { MobileKpiGrid } from "../components/MobileKpiGrid";

export function MyMirrorPage() {
  const { profile } = useAuth();

  const boardQuery = useQuery({
    queryKey: ["sales", "my-mirror", profile?.id],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const [dealsResult, timeBankResult, voiceResult, activityResult, companiesResult] = await Promise.all([
        supabase
          .from("crm_deals_weighted")
          .select("id, name, company_id, weighted_amount, next_follow_up_at, last_activity_at")
          .eq("assigned_rep_id", profile!.id)
          .is("closed_at", null)
          .limit(300),
        fetchTimeBankRows({
          workspaceId: profile?.active_workspace_id ?? "default",
          defaultBudgetDays: 14,
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
        supabase.from("crm_companies").select("id, name").limit(500),
      ]);

      if (dealsResult.error) throw new Error(dealsResult.error.message);
      if (companiesResult.error) throw new Error(companiesResult.error.message);

      const companyNameById = new Map(
        (companiesResult.data ?? []).map((row) => [row.id, row.name]),
      );
      const timeBankByDeal = new Map(timeBankResult.map((row) => [row.deal_id, row]));

      return {
        deals: (dealsResult.data ?? []).map((row) => ({
          dealId: row.id,
          dealName: row.name,
          companyName: row.company_id
            ? companyNameById.get(row.company_id) ?? "Account"
            : "Account",
          weightedAmount: row.weighted_amount ?? 0,
          nextFollowUpAt: row.next_follow_up_at,
          lastActivityAt: row.last_activity_at,
          pctUsed: timeBankByDeal.get(row.id)?.pct_used ?? null,
          isOver: Boolean(timeBankByDeal.get(row.id)?.is_over),
          overrunDays: timeBankByDeal.get(row.id)?.overrun_days ?? 0,
        })),
        voiceNotes30d: voiceResult.data?.length ?? 0,
        touches7d: activityResult.data?.length ?? 0,
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = useMemo(
    () => (boardQuery.data ? buildRepRealityBoard(boardQuery.data) : null),
    [boardQuery.data],
  );

  if (!profile?.id) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground" data-testid="my-mirror-no-profile">
        Profile required.
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 px-4 pb-6 pt-3" data-testid="my-mirror-page">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">My Mirror</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Private to you. A rep-owned mirror of pipeline hygiene, focus risk, and signal discipline.
        </p>
      </header>

      {boardQuery.isLoading ? (
        <div
          className="rounded-2xl border border-white/[0.06] bg-foreground/[0.04] p-6 text-sm text-muted-foreground animate-pulse"
          data-testid="my-mirror-loading"
        >
          Loading your reflection…
        </div>
      ) : boardQuery.isError || !board ? (
        <div
          className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
          data-testid="my-mirror-error"
        >
          {boardQuery.error instanceof Error
            ? boardQuery.error.message
            : "Your reflection is unavailable right now."}
        </div>
      ) : (
        <>
          <MobileKpiGrid
            items={[
              {
                id: "pipeline",
                label: "Pipeline",
                value: formatCurrency(board.summary.weightedRevenue),
                caption: "Weighted opportunity value",
                icon: <TrendingUp aria-hidden />,
                tone: "orange",
              },
              {
                id: "time-bank",
                label: "Time Bank",
                value: String(board.summary.overTimeDeals),
                caption: "Deals over budget",
                icon: <Timer aria-hidden />,
                tone:
                  board.summary.overTimeDeals > 0 ? "warning" : "default",
              },
              {
                id: "voice-notes",
                label: "Voice Notes",
                value: String(board.summary.voiceNotes30d),
                caption: "Last 30 days",
                icon: <Mic aria-hidden />,
              },
              {
                id: "overdue",
                label: "Overdue",
                value: String(board.summary.overdueFollowUps),
                caption: "Missed follow-ups",
                icon: <Eye aria-hidden />,
                tone: board.summary.overdueFollowUps > 0 ? "danger" : "default",
              },
            ]}
          />

          <section className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">Your deals</h2>
                <p className="text-xs text-muted-foreground">
                  Open deals weighted by opportunity value and signal discipline.
                </p>
              </div>
              <Link
                to="/qrm/deals"
                className="inline-flex items-center gap-1 text-xs font-semibold text-qep-orange whitespace-nowrap pt-0.5"
              >
                All deals <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            </div>

            {board.focusDeals.length === 0 ? (
              <div
                className="rounded-2xl border border-white/[0.06] bg-foreground/[0.04] px-4 py-6 text-center"
                data-testid="my-mirror-empty"
              >
                <p className="text-sm text-muted-foreground">
                  No deals assigned to you yet.
                </p>
                <Link
                  to="/sales/customers"
                  className="mt-3 inline-flex items-center gap-1 rounded-full bg-qep-orange px-4 py-2 text-xs font-semibold text-white"
                >
                  Browse customers
                </Link>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5" data-testid="my-mirror-deal-list">
                {board.focusDeals.slice(0, 10).map((deal) => (
                  <li key={deal.dealId}>
                    <Link
                      to={`/sales/deals/${deal.dealId}`}
                      className="block rounded-2xl border border-white/[0.06] bg-foreground/[0.04] p-3 hover:border-white/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {deal.companyName}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {deal.dealName}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-qep-orange tabular-nums">
                          {formatCurrency(deal.weightedAmount)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {deal.nextFollowUpAt && (
                          <span>
                            Follow-up{" "}
                            {new Date(deal.nextFollowUpAt).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                        )}
                        {deal.lastActivityAt && (
                          <span>
                            Last touch{" "}
                            {new Date(deal.lastActivityAt).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                        )}
                        {deal.pctUsed != null && (
                          <span
                            className={
                              deal.isOver
                                ? "font-semibold text-amber-300"
                                : "text-muted-foreground"
                            }
                          >
                            {deal.isOver
                              ? `+${deal.overrunDays ?? 0}d over`
                              : `${Math.round(deal.pctUsed * 100)}% of budget`}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
