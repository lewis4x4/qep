import { useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/lib/database.types";
import { QrmDealEditorSheet } from "../components/QrmDealEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
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
  const [editorOpen, setEditorOpen] = useState(false);
  const isElevated = userRole === "admin" || userRole === "manager" || userRole === "owner";

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

  const { handleDragStart, handleDragEnd, schedulePipelineRefresh } = useCrmPipelineDragDrop(
    queryClient,
    hydratedDeals,
    setHydratedDeals,
  );

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

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="QRM Pipeline"
        subtitle="21-step deal pipeline with SLA enforcement, drag-and-drop stage transitions, and real-time follow-up tracking."
      />
      <QrmSubNav />

      <div className="flex justify-end gap-2">
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
          onCommitPipelineFollowUp={commitPipelineFollowUpUpdate}
          onSchedulePipelineRefresh={schedulePipelineRefresh}
        />
      )}

      {!isLoading && !hasError && filteredDeals.length > 0 && viewMode === "board" && (
        <PipelineSwimLanesBoard
          stages={stagesQuery.data}
          stageColumns={stageColumns}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onCommitPipelineFollowUp={commitPipelineFollowUpUpdate}
          onSchedulePipelineRefresh={schedulePipelineRefresh}
        />
      )}

      <QrmDealEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(deal) => navigate(`/crm/deals/${deal.id}`)}
      />
    </div>
  );
}
