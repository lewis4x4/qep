import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Download, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { QrmDealEditorSheet } from "../components/QrmDealEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
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

  // Iron briefing: name the single sharpest move, not three paragraphs.
  const fmtMoney = (v: number) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${Math.round(v)}`;
  const pipelineIronHeadline = isLoading
    ? "Pipeline pressure is loading."
    : overdueCount > 0
      ? `${overdueCount} overdue follow-up${overdueCount === 1 ? "" : "s"} on the board — pull those forward before the rest of the pipeline. ${attentionCount} attention · ${staleCount} stale.`
      : attentionCount > 0
        ? `${attentionCount} deal${attentionCount === 1 ? "" : "s"} need a next-step touch today. ${staleCount} stale. No overdue follow-ups.`
        : staleCount > 0
          ? `${staleCount} stale deal${staleCount === 1 ? "" : "s"} — timing is the lever. Assign a next step or disposition.`
          : `${filteredDeals.length} deal${filteredDeals.length === 1 ? "" : "s"} in scope, pressure inside tolerance. Work the stage you're weakest in.`;

  const exportDealsCsv = () => {
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
  };

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Pipeline"
        subtitle="21-step deal graph with SLA enforcement and stage-gate drag-and-drop."
        crumb={{ surface: "GRAPH", lens: "DEALS", count: filteredDeals.length }}
        metrics={[
          { label: "Visible", value: filteredDeals.length.toLocaleString() },
          {
            label: "Overdue",
            value: overdueCount,
            tone: overdueCount > 0 ? "hot" : undefined,
          },
          {
            label: "Attention",
            value: attentionCount,
            tone: attentionCount > 0 ? "warm" : undefined,
          },
          {
            label: "Stale",
            value: staleCount,
            tone: staleCount > 0 ? "active" : undefined,
          },
          ...(showWeightedMetrics
            ? [
                {
                  label: "Weighted",
                  value: fmtMoney(weightedTotals.weightedPipeline),
                  tone: "live" as const,
                },
              ]
            : []),
        ]}
        ironBriefing={{
          headline: pipelineIronHeadline,
          actions:
            overdueCount > 0
              ? [{ label: "Filter overdue →", onClick: () => setUrgencyFilter("overdue_follow_up") }]
              : attentionCount > 0
                ? [{ label: "Filter attention →", onClick: () => setUrgencyFilter("attention") }]
                : undefined,
        }}
        rightRail={
          <div className="flex items-center gap-2">
            {viewMode === "board" && (
              <Button
                variant={showAnalytics ? "default" : "outline"}
                size="sm"
                className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]"
                onClick={() => setShowAnalytics((p) => !p)}
              >
                <BarChart3 className="mr-1 h-3.5 w-3.5" />
                {showAnalytics ? "Hide stats" : "Stats"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]"
              onClick={exportDealsCsv}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              CSV
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 font-mono text-[11px] uppercase tracking-[0.1em]"
              onClick={() => setEditorOpen(true)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New
            </Button>
          </div>
        }
      />
      <QrmSubNav />

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
