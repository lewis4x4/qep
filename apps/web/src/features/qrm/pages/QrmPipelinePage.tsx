import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ClipboardList,
  Download,
  Plus,
  ShieldAlert,
  Target,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { QrmDealEditorSheet } from "../components/QrmDealEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { DeckSurface } from "../components/command-deck";
import { PipelineAnalyticsOverlay } from "../components/PipelineAnalyticsOverlay";
import { PipelineDealsTableView } from "../components/PipelineDealsTableView";
import { PipelineFiltersBar } from "../components/PipelineFiltersBar";
import { PipelineManagerSummary } from "../components/PipelineManagerSummary";
import { PipelineQueryStatus } from "../components/PipelineQueryStatus";
import { PipelineSwimLanesBoard } from "../components/PipelineSwimLanesBoard";
import { listCrmDealStages, listCrmWeightedOpenDeals } from "../lib/qrm-api";
import {
  updateDealNextFollowUp,
  fetchOpenDealsFirstPage,
  type OpenDealsFirstPageResult,
} from "../lib/pipeline-utils";
import { computePipelineAnalytics } from "../lib/pipeline-analytics";
import { useOpenDealsHydration } from "../hooks/useOpenDealsHydration";
import { useCrmPipelineComputed, type UrgencyFilter } from "../hooks/useCrmPipelineComputed";
import { useCrmPipelineDragDrop } from "../hooks/useCrmPipelineDragDrop";

interface QrmPipelinePageProps {
  userRole: UserRole;
}

export function QrmPipelinePage({ userRole }: QrmPipelinePageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedStageId, setSelectedStageId] = useState<string>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [viewMode, setViewMode] = useState<"board" | "table">("board");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [healthDrawerProfileId, setHealthDrawerProfileId] = useState<string | null>(null);
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(() => new Set());
  const isElevated = userRole === "admin" || userRole === "manager" || userRole === "owner";
  const { toast } = useToast();

  const stagesQuery = useQuery({
    queryKey: ["crm", "deal-stages"],
    queryFn: listCrmDealStages,
    staleTime: 60_000,
  });

  const dealsQuery = useQuery({
    queryKey: ["crm", "deals", "open-table"],
    queryFn: fetchOpenDealsFirstPage,
    staleTime: 30_000,
  });

  const {
    hydratedDeals,
    setHydratedDeals,
    isHydratingRemainingDeals,
    dealHydrationWarning,
    hydrationAttempt,
    setHydrationAttempt,
  } = useOpenDealsHydration(dealsQuery.data, dealsQuery.dataUpdatedAt);

  const openDeals = hydratedDeals ?? dealsQuery.data?.items ?? [];
  const deferredOpenDeals = useDeferredValue(openDeals);
  const companyIds = useMemo(
    () => [...new Set(deferredOpenDeals.map((deal) => deal.companyId).filter((value): value is string => Boolean(value)))],
    [deferredOpenDeals],
  );
  const { data: healthProfiles = [] } = useQuery({
    queryKey: ["crm", "pipeline", "health-profiles", companyIds.join(",")],
    enabled: companyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            in: (column: string, values: string[]) => Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>;
          };
        };
      })
        .from("customer_profiles_extended")
        .select("id, crm_company_id, health_score")
        .in("crm_company_id", companyIds);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });
  const healthProfileByCompanyId = useMemo(() => {
    const map = new Map<string, { profileId: string; score: number | null }>();
    for (const row of healthProfiles) {
      if (typeof row.crm_company_id === "string" && typeof row.id === "string") {
        map.set(row.crm_company_id, {
          profileId: row.id,
          score: typeof row.health_score === "number" ? row.health_score : null,
        });
      }
    }
    return map;
  }, [healthProfiles]);

  const weightedDealsQuery = useQuery({
    queryKey: ["crm", "pipeline", "weighted-open-deals"],
    queryFn: listCrmWeightedOpenDeals,
    enabled: isElevated,
    staleTime: 30_000,
  });

  const {
    stageNameById,
    stageOptions,
    urgencyEvaluation,
    filteredDeals,
    stageSummary,
    stageColumns,
  } = useCrmPipelineComputed(
    stagesQuery.data,
    selectedStageId,
    urgencyFilter,
    deferredOpenDeals,
  );

  const isLoading = dealsQuery.isLoading || stagesQuery.isLoading;
  const hasError = dealsQuery.isError || stagesQuery.isError;

  const weightedTotals = useMemo(() => {
    return (weightedDealsQuery.data ?? []).reduce(
      (acc, deal) => {
        acc.openDeals += 1;
        acc.pipelineAmount += deal.amount ?? 0;
        acc.weightedPipeline += deal.weightedAmount ?? 0;
        return acc;
      },
      { openDeals: 0, pipelineAmount: 0, weightedPipeline: 0 },
    );
  }, [weightedDealsQuery.data]);

  const clearSelection = useCallback(() => setSelectedDealIds(new Set()), []);

  const handleDealSelectToggle = useCallback((dealId: string, _additive: boolean) => {
    setSelectedDealIds((current) => {
      const next = new Set(current);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }, []);

  const {
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    schedulePipelineRefresh,
    gateRejectedStageId,
  } = useCrmPipelineDragDrop(
    queryClient,
    hydratedDeals,
    setHydratedDeals,
    stagesQuery.data,
    (message) => toast({ title: "Stage gate", description: message, variant: "destructive" }),
    selectedDealIds,
    clearSelection,
  );

  const analyticsSnapshot = useMemo(() => {
    if (!showAnalytics) return null;
    return computePipelineAnalytics({
      stages: stagesQuery.data ?? [],
      deals: deferredOpenDeals,
    });
  }, [showAnalytics, stagesQuery.data, deferredOpenDeals]);

  function commitPipelineFollowUpUpdate(dealId: string, nextFollowUpAt: string | null): void {
    setHydratedDeals((current) => updateDealNextFollowUp(current, dealId, nextFollowUpAt));
    queryClient.setQueryData<OpenDealsFirstPageResult>(["crm", "deals", "open-table"], (current) => {
      if (!current) return current;
      return {
        ...current,
        items: updateDealNextFollowUp(current.items, dealId, nextFollowUpAt) ?? current.items,
      };
    });
  }

  const showWeightedMetrics = isElevated && !weightedDealsQuery.isLoading;
  const showStageDistribution = isElevated && stageSummary.length > 0;
  const attentionCount = urgencyEvaluation.counts.attention;
  const overdueCount = urgencyEvaluation.counts.overdue_follow_up;
  const staleCount = urgencyEvaluation.counts.stalled;
  const pipelineWhatMattersNow = isLoading
    ? "Pipeline pressure is loading."
    : `${filteredDeals.length} visible deal${filteredDeals.length === 1 ? "" : "s"}, ${attentionCount} needing attention, ${overdueCount} overdue, ${staleCount} stale.`;
  const pipelineNextMove = overdueCount > 0
    ? `Pull the ${overdueCount} overdue deal${overdueCount === 1 ? "" : "s"} forward before touching lower-pressure stages.`
    : attentionCount > 0
      ? `Work the ${attentionCount} attention item${attentionCount === 1 ? "" : "s"} so the board reflects real motion, not latent risk.`
      : "Use the board to tighten the next stage move and keep follow-up timing honest.";
  const pipelineRiskIfIgnored = overdueCount > 0 || staleCount > 0
    ? "If pipeline pressure is buried below filters, deals age quietly and operator trust drops."
    : "Without a clear top brief, the board becomes informative but not decisive.";

  const whatMattersBullets = isLoading
    ? []
    : [
        overdueCount > 0
          ? `${overdueCount} deal${overdueCount === 1 ? "" : "s"} overdue on follow-up`
          : null,
        staleCount > 0
          ? `${staleCount} deal${staleCount === 1 ? "" : "s"} stalled in stage`
          : null,
        attentionCount > 0
          ? `${attentionCount} attention item${attentionCount === 1 ? "" : "s"} ready to clear`
          : `${filteredDeals.length} active deal${filteredDeals.length === 1 ? "" : "s"} on the board`,
      ].filter((bullet): bullet is string => Boolean(bullet));

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="QRM Pipeline"
        subtitle="21-step deal pipeline with SLA enforcement, drag-and-drop stage transitions, and real-time follow-up tracking."
        crumb={{ surface: "GRAPH", lens: "DEALS", count: filteredDeals.length }}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <article className="flex gap-3 rounded-2xl border border-[#f28a07]/35 bg-[#f28a07]/10 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f28a07] text-[#15100a]">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f6a53a]">
              What matters now
            </p>
            <p className="mt-1.5 text-sm font-semibold leading-snug text-foreground">
              {pipelineWhatMattersNow}
            </p>
            {whatMattersBullets.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                {whatMattersBullets.map((bullet, idx) => (
                  <li key={idx} className="flex gap-1.5">
                    <span aria-hidden="true" className="text-emerald-400">✓</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </article>

        <article className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/25 text-[#f6a53a]">
            <Target className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Next move
            </p>
            <p className="mt-1.5 text-sm font-semibold leading-snug text-foreground">
              {pipelineNextMove}
            </p>
          </div>
        </article>

        <article className="flex gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-300">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-300">
              Risk if ignored
            </p>
            <p className="mt-1.5 text-sm leading-snug text-foreground">{pipelineRiskIfIgnored}</p>
          </div>
        </article>
      </div>

      <div className="flex justify-end gap-2">
        {viewMode === "board" && (
          <Button
            variant={showAnalytics ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAnalytics((p) => !p)}
          >
            <BarChart3 className="mr-1 h-4 w-4" />
            {showAnalytics ? "Hide Stats" : "Stage Stats"}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => {
          import("@/lib/csv-export").then(({ exportDeals }) => {
            exportDeals(filteredDeals.map((d) => ({
              id: d.id,
              name: d.name,
              amount: d.amount,
              expectedCloseOn: d.expectedCloseOn,
              nextFollowUpAt: d.nextFollowUpAt,
              lastActivityAt: d.lastActivityAt,
              depositStatus: d.depositStatus,
              depositAmount: d.depositAmount,
              createdAt: d.createdAt,
              stageName: null,
              companyName: null,
              contactName: null,
              assignedRepName: null,
            })));
          });
        }}>
          <Download className="mr-1 h-4 w-4" />
          Export CSV
        </Button>
        <Button onClick={() => setEditorOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New deal
        </Button>
      </div>

      <PipelineManagerSummary
        showWeightedMetrics={showWeightedMetrics}
        showStageDistribution={showStageDistribution}
        weightedTotals={weightedTotals}
        stageSummary={stageSummary}
      />

      <PipelineFiltersBar
        selectedStageId={selectedStageId}
        onStageChange={setSelectedStageId}
        stageOptions={stageOptions}
        urgencyFilter={urgencyFilter}
        onUrgencyChange={setUrgencyFilter}
        urgencyCounts={urgencyEvaluation.counts}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <PipelineQueryStatus
        isLoading={isLoading}
        hasError={hasError}
        isHydratingRemainingDeals={isHydratingRemainingDeals}
        dealHydrationWarning={dealHydrationWarning}
        onRetryHydration={() => setHydrationAttempt((v) => v + 1)}
        showCacheBanner={Boolean(dealsQuery.data?.fromCache)}
        showEmptyFilter={!isLoading && !hasError && filteredDeals.length === 0}
      />

      {!isLoading && !hasError && filteredDeals.length > 0 && viewMode === "table" && (
        <PipelineDealsTableView
          deals={filteredDeals}
          stageNameById={stageNameById}
          healthProfileByCompanyId={healthProfileByCompanyId}
          onCommitPipelineFollowUp={commitPipelineFollowUpUpdate}
          onSchedulePipelineRefresh={schedulePipelineRefresh}
          onOpenHealthProfile={(profileId) => setHealthDrawerProfileId(profileId)}
        />
      )}

      {!isLoading && !hasError && filteredDeals.length > 0 && viewMode === "board" && (
        <>
          {showAnalytics && analyticsSnapshot && (
            <PipelineAnalyticsOverlay snapshot={analyticsSnapshot} />
          )}
          <PipelineSwimLanesBoard
            stages={stagesQuery.data}
            stageColumns={stageColumns}
            healthProfileByCompanyId={healthProfileByCompanyId}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onCommitPipelineFollowUp={commitPipelineFollowUpUpdate}
            onSchedulePipelineRefresh={schedulePipelineRefresh}
            onOpenHealthProfile={(profileId) => setHealthDrawerProfileId(profileId)}
            showAnalytics={showAnalytics}
            bottleneckStageId={analyticsSnapshot?.bottleneckStageId ?? null}
            gateRejectedStageId={gateRejectedStageId}
            selectedDealIds={selectedDealIds}
            onDealSelectToggle={handleDealSelectToggle}
          />
        </>
      )}

      <QrmDealEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(deal) => navigate(`/crm/deals/${deal.id}`)}
      />
      <HealthScoreDrawer
        customerProfileId={healthDrawerProfileId}
        open={healthDrawerProfileId !== null}
        onOpenChange={(open) => !open && setHealthDrawerProfileId(null)}
      />
    </div>
  );
}
