import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { CrmDealSignalBadges } from "../components/CrmDealSignalBadges";
import { getDealSignalState } from "../lib/deal-signals";
import { CrmPageHeader } from "../components/CrmPageHeader";
import {
  listCrmDealStages,
  listCrmOpenDealsForBoard,
  listCrmWeightedOpenDeals,
} from "../lib/crm-api";
import type { CrmRepSafeDeal } from "../lib/types";

interface CrmPipelinePageProps {
  userRole: UserRole;
}

type UrgencyFilter = "all" | "overdue_follow_up" | "no_follow_up" | "stalled" | "data_issues" | "attention";

const OPEN_DEALS_PAGE_SIZE = 500;
const HYDRATION_UPDATE_BATCH_PAGES = 10;
const PIPELINE_CACHE_KEY = "qep-crm-open-deals-cache-v1";

interface DealUrgencyState {
  isOverdueFollowUp: boolean;
  hasNoFollowUp: boolean;
  isStalled: boolean;
  hasDataIssue: boolean;
  needsAttention: boolean;
}

interface CachedOpenDealsPayload {
  items: CrmRepSafeDeal[];
  nextCursor: string | null;
}

interface OpenDealsFirstPageResult extends CachedOpenDealsPayload {
  fromCache: boolean;
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

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Invalid date";
  }

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getFollowUpSortTime(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function readCachedOpenDeals(): CachedOpenDealsPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PIPELINE_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedOpenDealsPayload>;
    if (!Array.isArray(parsed.items)) {
      return null;
    }

    return {
      items: parsed.items as CrmRepSafeDeal[],
      nextCursor: typeof parsed.nextCursor === "string" ? parsed.nextCursor : null,
    };
  } catch (error) {
    return null;
  }
}

function writeCachedOpenDeals(payload: CachedOpenDealsPayload): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PIPELINE_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore cache write failures; this is a best-effort resilience layer.
  }
}

async function fetchOpenDealsFirstPage(): Promise<OpenDealsFirstPageResult> {
  try {
    const result = await listCrmOpenDealsForBoard({ limit: OPEN_DEALS_PAGE_SIZE });
    writeCachedOpenDeals({ items: result.items, nextCursor: result.nextCursor });
    return {
      items: result.items,
      nextCursor: result.nextCursor,
      fromCache: false,
    };
  } catch (error) {
    const cached = readCachedOpenDeals();
    if (cached) {
      return {
        items: cached.items,
        nextCursor: cached.nextCursor,
        fromCache: true,
      };
    }
    throw error;
  }
}

export function CrmDealsPage({ userRole }: CrmPipelinePageProps) {
  const [selectedStageId, setSelectedStageId] = useState<string>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");
  const [viewMode, setViewMode] = useState<"board" | "table">("board");
  const [hydratedDeals, setHydratedDeals] = useState<CrmRepSafeDeal[] | null>(null);
  const [isHydratingRemainingDeals, setIsHydratingRemainingDeals] = useState(false);
  const [dealHydrationWarning, setDealHydrationWarning] = useState<string | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
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

  useEffect(() => {
    const firstPage = dealsQuery.data;
    if (!firstPage) {
      setHydratedDeals(null);
      setIsHydratingRemainingDeals(false);
      setDealHydrationWarning(null);
      return;
    }

    let cancelled = false;
    const seenCursors = new Set<string>();
    let mergedItems = [...firstPage.items];
    setHydratedDeals(mergedItems);
    setDealHydrationWarning(null);

    if (firstPage.fromCache) {
      setIsHydratingRemainingDeals(false);
      return () => {
        cancelled = true;
      };
    }

    if (!firstPage.nextCursor) {
      setIsHydratingRemainingDeals(false);
      return () => {
        cancelled = true;
      };
    }

    setIsHydratingRemainingDeals(true);
    void (async () => {
      let cursor = firstPage.nextCursor;
      let pagesSinceLastUpdate = 0;

      while (cursor && !cancelled) {
        if (seenCursors.has(cursor)) {
          setDealHydrationWarning("Stopped loading additional deals due to a pagination loop. Showing partial results.");
          break;
        }
        seenCursors.add(cursor);

        try {
          const pageResult = await listCrmOpenDealsForBoard({
            limit: OPEN_DEALS_PAGE_SIZE,
            cursor,
          });
          mergedItems = [...mergedItems, ...pageResult.items];
          pagesSinceLastUpdate += 1;
          if (!cancelled && (pagesSinceLastUpdate >= HYDRATION_UPDATE_BATCH_PAGES || !pageResult.nextCursor)) {
            const snapshot = mergedItems;
            startTransition(() => {
              setHydratedDeals(snapshot);
            });
            pagesSinceLastUpdate = 0;
          }
          cursor = pageResult.nextCursor;
        } catch {
          if (!cancelled) {
            setDealHydrationWarning("Could not load all deal pages. Showing partial results.");
          }
          break;
        }
      }

      if (!cancelled) {
        writeCachedOpenDeals({ items: mergedItems, nextCursor: null });
        setIsHydratingRemainingDeals(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dealsQuery.dataUpdatedAt, hydrationAttempt]);

  const openDeals = hydratedDeals ?? dealsQuery.data?.items ?? [];
  const deferredOpenDeals = useDeferredValue(openDeals);

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

  const stageFilteredDeals = useMemo(() => {
    if (selectedStageId === "all") {
      return deferredOpenDeals;
    }

    return deferredOpenDeals.filter((deal) => deal.stageId === selectedStageId);
  }, [deferredOpenDeals, selectedStageId]);

  const urgencyEvaluation = useMemo(() => {
    const now = Date.now();
    const byDealId = new Map<string, DealUrgencyState>();
    const counts: Record<UrgencyFilter, number> = {
      all: stageFilteredDeals.length,
      overdue_follow_up: 0,
      no_follow_up: 0,
      stalled: 0,
      data_issues: 0,
      attention: 0,
    };

    for (const deal of stageFilteredDeals) {
      const { isOverdueFollowUp, isStalled } = getDealSignalState(deal, now);
      const hasNoFollowUp = !deal.nextFollowUpAt;
      const hasDataIssue = (deal.nextFollowUpAt !== null && !Number.isFinite(Date.parse(deal.nextFollowUpAt))) ||
        (deal.lastActivityAt !== null && !Number.isFinite(Date.parse(deal.lastActivityAt)));
      const needsAttention = isOverdueFollowUp || hasNoFollowUp || isStalled || hasDataIssue;
      const state: DealUrgencyState = {
        isOverdueFollowUp,
        hasNoFollowUp,
        isStalled,
        hasDataIssue,
        needsAttention,
      };

      byDealId.set(deal.id, state);

      if (state.isOverdueFollowUp) {
        counts.overdue_follow_up += 1;
      }
      if (state.hasNoFollowUp) {
        counts.no_follow_up += 1;
      }
      if (state.isStalled) {
        counts.stalled += 1;
      }
      if (state.hasDataIssue) {
        counts.data_issues += 1;
      }
      if (state.needsAttention) {
        counts.attention += 1;
      }
    }

    return {
      counts,
      byDealId,
    };
  }, [stageFilteredDeals]);

  const filteredDeals = useMemo(() => {
    if (urgencyFilter === "all") {
      return stageFilteredDeals;
    }

    return stageFilteredDeals.filter((deal) => {
      const state = urgencyEvaluation.byDealId.get(deal.id);
      if (!state) {
        return false;
      }

      if (urgencyFilter === "overdue_follow_up") {
        return state.isOverdueFollowUp;
      }

      if (urgencyFilter === "no_follow_up") {
        return state.hasNoFollowUp;
      }

      if (urgencyFilter === "stalled") {
        return state.isStalled;
      }

      if (urgencyFilter === "data_issues") {
        return state.hasDataIssue;
      }

      return state.needsAttention;
    });
  }, [stageFilteredDeals, urgencyFilter, urgencyEvaluation.byDealId]);

  const stageSummary = useMemo(() => {
    const byStage = new Map<string, { count: number; amount: number }>();

    for (const deal of deferredOpenDeals) {
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
  }, [deferredOpenDeals, stageNameById]);

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
          const nextA = getFollowUpSortTime(a.nextFollowUpAt);
          const nextB = getFollowUpSortTime(b.nextFollowUpAt);
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
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="crm-stage-filter" className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#64748B]">
              Filter stage
            </label>
            <select
              id="crm-stage-filter"
              value={selectedStageId}
              onChange={(event) => setSelectedStageId(event.target.value)}
              className="h-11 w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm transition focus:border-[#E87722] focus:outline-none focus:ring-2 focus:ring-[#E87722]/25"
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
            <label htmlFor="crm-urgency-filter" className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#64748B]">
              Follow-up queue
            </label>
            <select
              id="crm-urgency-filter"
              value={urgencyFilter}
              onChange={(event) => setUrgencyFilter(event.target.value as UrgencyFilter)}
              className="h-11 w-full rounded-xl border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm transition focus:border-[#E87722] focus:outline-none focus:ring-2 focus:ring-[#E87722]/25"
            >
              <option value="all">All deals in stage ({urgencyEvaluation.counts.all})</option>
              <option value="attention">Needs attention ({urgencyEvaluation.counts.attention})</option>
              <option value="overdue_follow_up">Overdue follow-up ({urgencyEvaluation.counts.overdue_follow_up})</option>
              <option value="no_follow_up">No follow-up scheduled ({urgencyEvaluation.counts.no_follow_up})</option>
              <option value="stalled">Stalled activity ({urgencyEvaluation.counts.stalled})</option>
              <option value="data_issues">Data issues ({urgencyEvaluation.counts.data_issues})</option>
            </select>
            <p className="mt-1 text-xs text-[#64748B]">Counts reflect the currently selected stage.</p>
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
