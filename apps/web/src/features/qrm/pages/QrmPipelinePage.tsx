import { useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Download, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
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
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [healthDrawerProfileId, setHealthDrawerProfileId] = useState<string | null>(null);
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

  const { handleDragStart, handleDragEnd, schedulePipelineRefresh } = useCrmPipelineDragDrop(
    queryClient,
    hydratedDeals,
    setHydratedDeals,
    stagesQuery.data,
    (message) => toast({ title: "Stage gate", description: message, variant: "destructive" }),
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

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="QRM Pipeline"
        subtitle="21-step deal pipeline with SLA enforcement, drag-and-drop stage transitions, and real-time follow-up tracking."
      />
      <QrmSubNav />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What matters now</p>
          <p className="mt-2 text-sm text-foreground">{pipelineWhatMattersNow}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next move</p>
          <p className="mt-2 text-sm text-foreground">{pipelineNextMove}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk if ignored</p>
          <p className="mt-2 text-sm text-foreground">{pipelineRiskIfIgnored}</p>
        </Card>
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
        <PipelineSwimLanesBoard
          stages={stagesQuery.data}
          stageColumns={stageColumns}
          healthProfileByCompanyId={healthProfileByCompanyId}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onCommitPipelineFollowUp={commitPipelineFollowUpUpdate}
          onSchedulePipelineRefresh={schedulePipelineRefresh}
          onOpenHealthProfile={(profileId) => setHealthDrawerProfileId(profileId)}
          showAnalytics={showAnalytics}
        />
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
