import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { CrmDealSignalBadges } from "../components/CrmDealSignalBadges";
import { CrmPageHeader } from "../components/CrmPageHeader";
import {
  listCrmDealStages,
  listCrmOpenDealsForBoard,
  listCrmWeightedOpenDeals,
} from "../lib/crm-api";

interface CrmPipelinePageProps {
  userRole: UserRole;
}

function formatMoney(value: number | null): string {
  if (value === null) {
    return "Amount TBD";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not set";
  }

  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CrmDealsPage({ userRole }: CrmPipelinePageProps) {
  const [selectedStageId, setSelectedStageId] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"board" | "table">("board");
  const isElevated = userRole === "admin" || userRole === "manager" || userRole === "owner";

  const stagesQuery = useQuery({
    queryKey: ["crm", "deal-stages"],
    queryFn: listCrmDealStages,
    staleTime: 60_000,
  });

  const dealsQuery = useQuery({
    queryKey: ["crm", "deals", "open-table"],
    queryFn: () => listCrmOpenDealsForBoard({ limit: 500 }),
    staleTime: 30_000,
  });

  const weightedDealsQuery = useQuery({
    queryKey: ["crm", "pipeline", "weighted-open-deals"],
    queryFn: listCrmWeightedOpenDeals,
    enabled: isElevated,
    staleTime: 30_000,
  });

  const stageNameById = useMemo(() => {
    return new Map((stagesQuery.data ?? []).map((stage) => [stage.id, stage.name]));
  }, [stagesQuery.data]);

  const stageOptions = useMemo(() => {
    return (stagesQuery.data ?? [])
      .filter((stage) => !stage.isClosedWon && !stage.isClosedLost)
      .map((stage) => ({ id: stage.id, name: stage.name }));
  }, [stagesQuery.data]);

  const filteredDeals = useMemo(() => {
    const deals = dealsQuery.data?.items ?? [];
    if (selectedStageId === "all") {
      return deals;
    }

    return deals.filter((deal) => deal.stageId === selectedStageId);
  }, [dealsQuery.data?.items, selectedStageId]);

  const stageSummary = useMemo(() => {
    const byStage = new Map<string, { count: number; amount: number }>();

    for (const deal of dealsQuery.data?.items ?? []) {
      const current = byStage.get(deal.stageId) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += deal.amount ?? 0;
      byStage.set(deal.stageId, current);
    }

    return Array.from(byStage.entries()).map(([stageId, value]) => ({
      stageId,
      stageName: stageNameById.get(stageId) ?? "Unknown stage",
      count: value.count,
      amount: value.amount,
    }));
  }, [dealsQuery.data?.items, stageNameById]);

  const stageColumns = useMemo(() => {
    const openStages = stageOptions.length > 0
      ? stageOptions
      : Array.from(stageNameById.entries()).map(([id, name]) => ({ id, name }));
    const visibleStages = selectedStageId === "all"
      ? openStages
      : openStages.filter((stage) => stage.id === selectedStageId);

    return visibleStages.map((stage) => {
      const deals = filteredDeals
        .filter((deal) => deal.stageId === stage.id)
        .sort((a, b) => {
          const nextA = a.nextFollowUpAt ? new Date(a.nextFollowUpAt).getTime() : Number.POSITIVE_INFINITY;
          const nextB = b.nextFollowUpAt ? new Date(b.nextFollowUpAt).getTime() : Number.POSITIVE_INFINITY;
          if (nextA !== nextB) return nextA - nextB;
          return (b.amount ?? 0) - (a.amount ?? 0);
        });
      const amount = deals.reduce((total, deal) => total + (deal.amount ?? 0), 0);
      return {
        stageId: stage.id,
        stageName: stage.name,
        deals,
        amount,
      };
    });
  }, [filteredDeals, selectedStageId, stageOptions, stageNameById]);

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
      {
        openDeals: 0,
        pipelineAmount: 0,
        weightedPipeline: 0,
      }
    );
  }, [weightedDealsQuery.data]);

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <CrmPageHeader
        title="CRM Deals"
        subtitle="Table-first pipeline view with role-safe CRM reads and quote entry points."
      />

      {isElevated && !weightedDealsQuery.isLoading && (
        <section
          className="grid grid-cols-3 gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4"
          aria-label="Manager deal summary"
        >
          <Metric label="Open deals" value={String(weightedTotals.openDeals)} />
          <Metric label="Pipeline amount" value={formatMoney(weightedTotals.pipelineAmount)} />
          <Metric label="Weighted" value={formatMoney(weightedTotals.weightedPipeline)} />
        </section>
      )}

      {isElevated && stageSummary.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-[#E2E8F0] px-4 py-3">
            <h2 className="text-sm font-semibold text-[#0F172A]">Stage distribution</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#F8FAFC] text-xs uppercase tracking-wide text-[#475569]">
                <tr>
                  <th className="px-4 py-2 text-left">Stage</th>
                  <th className="px-4 py-2 text-right">Deals</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {stageSummary.map((item) => (
                  <tr key={item.stageId} className="border-t border-[#E2E8F0]">
                    <td className="px-4 py-2 text-[#0F172A]">{item.stageName}</td>
                    <td className="px-4 py-2 text-right text-[#334155]">{item.count}</td>
                    <td className="px-4 py-2 text-right text-[#334155]">{formatMoney(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="crm-stage-filter" className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#64748B]">
              Filter stage
            </label>
            <select
              id="crm-stage-filter"
              value={selectedStageId}
              onChange={(event) => setSelectedStageId(event.target.value)}
              className="h-10 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A]"
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
            <p className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#64748B]">View</p>
            <div className="flex rounded-md border border-[#CBD5E1] bg-white p-1">
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
            <div key={index} className="h-16 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />
          ))}
        </div>
      )}

      {hasError && !isLoading && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">Unable to load deals right now. Refresh and try again.</p>
        </Card>
      )}

      {!isLoading && !hasError && filteredDeals.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">No open deals matched this filter.</p>
        </Card>
      )}

      {!isLoading && !hasError && filteredDeals.length > 0 && viewMode === "table" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="CRM deals table">
              <thead className="bg-[#F8FAFC] text-xs uppercase tracking-wide text-[#475569]">
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
                  <tr key={deal.id} className="border-t border-[#E2E8F0]">
                    <td className="px-4 py-3">
                      <Link to={`/crm/deals/${deal.id}`} className="font-semibold text-[#0F172A] hover:text-[#B45309]">
                        {deal.name}
                      </Link>
                      <p className="text-xs text-[#64748B]">Last activity: {formatDate(deal.lastActivityAt)}</p>
                    </td>
                    <td className="px-4 py-3 text-[#334155]">{stageNameById.get(deal.stageId) ?? "Unknown stage"}</td>
                    <td className="px-4 py-3 text-right text-[#334155]">{formatMoney(deal.amount)}</td>
                    <td className="px-4 py-3 text-[#334155]">{formatDate(deal.expectedCloseOn)}</td>
                    <td className="px-4 py-3 text-[#334155]">{formatDate(deal.nextFollowUpAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link
                            to={`/quote?crm_deal_id=${deal.id}${deal.primaryContactId ? `&crm_contact_id=${deal.primaryContactId}` : ""}`}
                          >
                            <FileText className="mr-1 h-4 w-4" />
                            New Quote
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!isLoading && !hasError && filteredDeals.length > 0 && viewMode === "board" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto" aria-label="CRM deals board">
            <div className="flex min-w-max gap-3 p-3">
              {stageColumns.map((column) => (
                <section
                  key={column.stageId}
                  className="w-[300px] shrink-0 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]"
                >
                  <header className="border-b border-[#E2E8F0] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[#0F172A]">{column.stageName}</h3>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-[#475569]">
                        {column.deals.length}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#64748B]">{formatMoney(column.amount)}</p>
                  </header>

                  <div className="space-y-2 p-2">
                    {column.deals.length === 0 && (
                      <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-white px-3 py-4 text-center text-xs text-[#64748B]">
                        No open deals in this stage.
                      </div>
                    )}

                    {column.deals.map((deal) => (
                      <article key={deal.id} className="rounded-lg border border-[#E2E8F0] bg-white p-3 shadow-sm">
                        <Link
                          to={`/crm/deals/${deal.id}`}
                          className="text-sm font-semibold text-[#0F172A] hover:text-[#B45309]"
                        >
                          {deal.name}
                        </Link>
                        <p className="mt-1 text-xs text-[#475569]">
                          {formatMoney(deal.amount)} • Follow-up {formatDate(deal.nextFollowUpAt)}
                        </p>
                        <div className="mt-2">
                          <CrmDealSignalBadges deal={deal} />
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
                            <Link to={`/crm/deals/${deal.id}`}>Open</Link>
                          </Button>
                          <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs">
                            <Link
                              to={`/quote?crm_deal_id=${deal.id}${deal.primaryContactId ? `&crm_contact_id=${deal.primaryContactId}` : ""}`}
                            >
                              <FileText className="mr-1 h-3.5 w-3.5" />
                              Quote
                            </Link>
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[#64748B]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[#0F172A]">{value}</p>
    </div>
  );
}

export const CrmPipelinePage = CrmDealsPage;
