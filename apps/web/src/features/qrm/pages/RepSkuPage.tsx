import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BadgeDollarSign, Mic2, Package2, TimerReset, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { DeckSurface } from "../components/command-deck";
import {
  buildRepSkuBoard,
  normalizeRepSkuDealRows,
  normalizeRepSkuProfileRows,
  normalizeRepSkuStageRows,
  normalizeRepSkuTimeBankRows,
} from "../lib/rep-sku";
import { crmSupabase } from "../lib/qrm-supabase";

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

export function RepSkuPage() {
  const { profile } = useAuth();

  const boardQuery = useQuery({
    queryKey: ["qrm", "rep-sku", profile?.active_workspace_id],
    enabled: Boolean(profile?.active_workspace_id),
    queryFn: async () => {
      const [dealsResult, stagesResult, kpisResult, voiceResult, activityResult, timeBankResult] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("id, stage_id, amount, assigned_rep_id, last_activity_at")
          .is("deleted_at", null)
          .is("closed_at", null)
          .not("assigned_rep_id", "is", null)
          .limit(500),
        supabase
          .from("crm_deal_stages")
          .select("id, sort_order, name")
          .order("sort_order", { ascending: true })
          .limit(100),
        supabase
          .from("prospecting_kpis")
          .select("rep_id, positive_visits, target_met, opportunities_created, quotes_generated, kpi_date")
          .gte("kpi_date", new Date(Date.now() - 14 * 86_400_000).toISOString().split("T")[0])
          .limit(500),
        supabase
          .from("voice_captures")
          .select("user_id")
          .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .limit(1000),
        supabase
          .from("crm_activities")
          .select("created_by")
          .gte("occurred_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
          .limit(2000),
        crmSupabase.rpc("qrm_time_bank", {
          p_workspace_id: profile?.active_workspace_id ?? "default",
          p_default_budget_days: 14,
        }),
      ]);

      if (dealsResult.error) throw new Error(dealsResult.error.message);
      if (stagesResult.error) throw new Error(stagesResult.error.message);
      if (kpisResult.error) throw new Error(kpisResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (activityResult.error) throw new Error(activityResult.error.message);
      if (timeBankResult.error) throw new Error(timeBankResult.error.message ?? "Failed to load time bank.");

      const repIds = Array.from(new Set([
        ...(dealsResult.data ?? []).map((row) => row.assigned_rep_id).filter((value): value is string => Boolean(value)),
        ...(kpisResult.data ?? []).map((row) => row.rep_id).filter((value): value is string => Boolean(value)),
        ...(voiceResult.data ?? []).map((row) => row.user_id).filter((value): value is string => Boolean(value)),
        ...(activityResult.data ?? []).map((row) => row.created_by).filter((value): value is string => Boolean(value)),
      ]));

      const profilesResult = repIds.length > 0
        ? await supabase.from("profiles").select("id, full_name, email").in("id", repIds)
        : { data: [], error: null };

      if (profilesResult.error) throw new Error(profilesResult.error.message);

      const voiceByRepId = new Map<string, number>();
      for (const row of voiceResult.data ?? []) {
        if (!row.user_id) continue;
        voiceByRepId.set(row.user_id, (voiceByRepId.get(row.user_id) ?? 0) + 1);
      }

      const activityByRepId = new Map<string, number>();
      for (const row of activityResult.data ?? []) {
        if (!row.created_by) continue;
        activityByRepId.set(row.created_by, (activityByRepId.get(row.created_by) ?? 0) + 1);
      }

      const kpiAgg = new Map<string, { positiveVisits: number; targetMet: boolean; opportunitiesCreated: number; quotesGenerated: number }>();
      for (const row of kpisResult.data ?? []) {
        const current = kpiAgg.get(row.rep_id) ?? { positiveVisits: 0, targetMet: false, opportunitiesCreated: 0, quotesGenerated: 0 };
        current.positiveVisits += row.positive_visits ?? 0;
        current.targetMet = current.targetMet || Boolean(row.target_met);
        current.opportunitiesCreated += row.opportunities_created ?? 0;
        current.quotesGenerated += row.quotes_generated ?? 0;
        kpiAgg.set(row.rep_id, current);
      }

      return buildRepSkuBoard({
        deals: normalizeRepSkuDealRows(dealsResult.data),
        stages: normalizeRepSkuStageRows(stagesResult.data),
        repProfiles: normalizeRepSkuProfileRows(profilesResult.data),
        timeBankRows: normalizeRepSkuTimeBankRows(timeBankResult.data),
        kpis: [...kpiAgg.entries()].map(([repId, value]) => ({
          repId,
          positiveVisits: value.positiveVisits,
          targetMet: value.targetMet,
          opportunitiesCreated: value.opportunitiesCreated,
          quotesGenerated: value.quotesGenerated,
        })),
        voiceByRepId,
        activityByRepId,
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Rep as SKU"
        subtitle="Every rep modeled as a packaged offering from live pipeline, prospecting, cadence, and field-signal evidence."
        crumb={{ surface: "PULSE", lens: "REP SKU" }}
      />

      {boardQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading rep packages…</DeckSurface>
      ) : boardQuery.isError || !board ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Rep packaging is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Package2} label="Rep Packages" value={String(board.summary.reps)} />
            <SummaryCard icon={BadgeDollarSign} label="Loaded" value={String(board.summary.loadedReps)} />
            <SummaryCard icon={TimerReset} label="Overloaded" value={String(board.summary.overloadedReps)} tone={board.summary.overloadedReps > 0 ? "warn" : "default"} />
            <SummaryCard icon={Mic2} label="Field Signal Reps" value={String(board.summary.fieldSignalReps)} />
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Rep packages</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each package describes what kind of selling motion this rep currently looks best suited for, based on live operating evidence.
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/qrm/deals">
                    Pipeline <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/qrm/my/reality">
                    My Mirror <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {board.reps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rep package signals are active right now.</p>
              ) : (
                board.reps.map((rep) => (
                  <div key={rep.repId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{rep.repName}</p>
                          <span className={`text-[11px] font-medium ${confidenceTone(rep.confidence)}`}>
                            {rep.confidence} confidence
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-medium text-qep-orange">{rep.packageLabel}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Best for: {rep.bestFor}</p>
                        <div className="mt-3 space-y-1">
                          {rep.trace.map((line) => (
                            <p key={line} className="text-xs text-muted-foreground">
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link to={rep.href}>
                          {rep.actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
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
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}
