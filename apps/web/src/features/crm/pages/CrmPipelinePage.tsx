import { useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { CrmDealEditorSheet } from "../components/CrmDealEditorSheet";
import { CrmPageHeader } from "../components/CrmPageHeader";
import { CrmSubNav } from "../components/CrmSubNav";
import { PipelineDealTableRow } from "../components/PipelineDealTableRow";
import { PipelineSwimLanesBoard } from "../components/PipelineSwimLanesBoard";
import { listCrmDealStages, listCrmWeightedOpenDeals } from "../lib/crm-api";
import {
  formatMoney,
  updateDealNextFollowUp,
  fetchOpenDealsFirstPage,
  type OpenDealsFirstPageResult,
} from "../lib/pipeline-utils";
import { useOpenDealsHydration } from "../hooks/useOpenDealsHydration";
import {
  useCrmPipelineComputed,
  type UrgencyFilter,
} from "../hooks/useCrmPipelineComputed";
import { useCrmPipelineDragDrop } from "../hooks/useCrmPipelineDragDrop";

interface CrmPipelinePageProps {
  userRole: UserRole;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function CrmDealsPage({ userRole }: CrmPipelinePageProps) {
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

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <CrmPageHeader
        title="QRM Pipeline"
        subtitle="21-step deal pipeline with SLA enforcement, drag-and-drop stage transitions, and real-time follow-up tracking."
      />
      <CrmSubNav />

      <div className="flex justify-end">
        <Button onClick={() => setEditorOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New deal
        </Button>
      </div>

      {isElevated && !weightedDealsQuery.isLoading && (
        <section
          className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-card p-4"
          aria-label="Manager deal summary"
        >
          <Metric label="Open deals" value={String(weightedTotals.openDeals)} />
          <Metric label="Pipeline amount" value={formatMoney(weightedTotals.pipelineAmount)} />
          <Metric label="Weighted" value={formatMoney(weightedTotals.weightedPipeline)} />
        </section>
      )}

      {isElevated && stageSummary.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Stage distribution</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Stage</th>
                  <th className="px-4 py-2 text-right">Deals</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {stageSummary.map((item) => (
                  <tr key={item.stageId} className="border-t border-border">
                    <td className="px-4 py-2 text-foreground">{item.stageName}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{item.count}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{formatMoney(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-3 sm:p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="crm-stage-filter" className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Filter stage
            </label>
            <select
              id="crm-stage-filter"
              value={selectedStageId}
              onChange={(event) => setSelectedStageId(event.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="all">All open stages</option>
              {stageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="crm-urgency-filter" className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Follow-up queue
            </label>
            <select
              id="crm-urgency-filter"
              value={urgencyFilter}
              onChange={(event) => setUrgencyFilter(event.target.value as UrgencyFilter)}
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="all">All deals in stage ({urgencyEvaluation.counts.all})</option>
              <option value="attention">Needs attention ({urgencyEvaluation.counts.attention})</option>
              <option value="overdue_follow_up">Overdue follow-up ({urgencyEvaluation.counts.overdue_follow_up})</option>
              <option value="no_follow_up">No follow-up scheduled ({urgencyEvaluation.counts.no_follow_up})</option>
              <option value="stalled">Stalled activity ({urgencyEvaluation.counts.stalled})</option>
              <option value="data_issues">Data issues ({urgencyEvaluation.counts.data_issues})</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Counts reflect the currently selected stage.</p>
          </div>
          <div>
            <p className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">View</p>
            <div className="flex rounded-md border border-input bg-card p-1">
              <Button
                type="button"
                size="sm"
                variant={viewMode === "board" ? "default" : "ghost"}
                className="h-8 flex-1"
                onClick={() => setViewMode("board")}
              >
                Board
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === "table" ? "default" : "ghost"}
                className="h-8 flex-1"
                onClick={() => setViewMode("table")}
              >
                Table
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading deals table">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      )}

      {hasError && !isLoading && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Unable to load deals right now. Refresh and try again.</p>
        </Card>
      )}

      {!isLoading && !hasError && isHydratingRemainingDeals && (
        <Card className="border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">Loading additional open deals in the background.</p>
        </Card>
      )}

      {!isLoading && !hasError && dealHydrationWarning && (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-amber-900">{dealHydrationWarning}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setHydrationAttempt((value) => value + 1)}>
              Retry full load
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && !hasError && dealsQuery.data?.fromCache && (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">Showing a cached pipeline snapshot while live CRM data is unavailable.</p>
        </Card>
      )}

      {!isLoading && !hasError && filteredDeals.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">No open deals matched this filter.</p>
        </Card>
      )}

      {!isLoading && !hasError && filteredDeals.length > 0 && viewMode === "table" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="QRM deals table">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Deal</th>
                  <th className="px-4 py-2 text-left">Stage</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-left">Target Close</th>
                  <th className="px-4 py-2 text-left">Follow-up</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map((deal) => (
                  <PipelineDealTableRow
                    key={deal.id}
                    deal={deal}
                    stageName={stageNameById.get(deal.stageId) ?? "Unknown stage"}
                    onCommitPipelineFollowUp={commitPipelineFollowUpUpdate}
                    onSchedulePipelineRefresh={schedulePipelineRefresh}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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

      <CrmDealEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(deal) => navigate(`/crm/deals/${deal.id}`)}
      />
    </div>
  );
}

export const CrmPipelinePage = CrmDealsPage;
