import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  Filter,
  Info,
  List,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trophy,
  Trash2,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import type { QuoteListItem } from "../../../../../../shared/qep-moonshot-contracts";
import {
  getScorerCalibrationObservations,
  listQuotePackages,
  performQuoteListAction,
  sendQuotePackage,
  type QuoteListAction,
} from "../lib/quote-api";
import {
  clearLocalDraft,
  listLocalDraftsForUser,
  type LocalDraftRecord,
} from "../lib/local-draft";
import { computeCalibrationReport, formatPct } from "../lib/scorer-calibration";

const STATUS_FILTERS = ["all", "draft", "ready", "sent", "accepted"] as const;
const PIPELINE_STATUSES = new Set(["draft", "ready", "sent", "pending_approval"]);
const TERMINAL_STATUSES = new Set(["accepted", "declined", "rejected", "expired", "archived", "converted_to_deal"]);

export type QuoteStatFilter = "total" | "open" | "pipeline" | "wins";
export type QuoteSortKey = "quote" | "customer" | "equipment" | "total" | "score" | "updated";
type SortDirection = "asc" | "desc";

interface QuoteSort {
  key: QuoteSortKey;
  direction: SortDirection;
}

interface Stats {
  total: number;
  open: number;
  pipelineValue: number;
  winsThisMonth: number;
  winsValueMTD: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Ready",
  approved_with_conditions: "Ready",
  changes_requested: "Draft",
  ready: "Ready",
  sent: "Sent",
  viewed: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  rejected: "Declined",
  expired: "Expired",
  archived: "Archived",
  converted_to_deal: "Accepted",
};

const STATUS_CHIP_CLASSES: Record<string, string> = {
  draft: "bg-slate-600/40 text-slate-100 border-slate-500/30",
  pending_approval: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ready: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  sent: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  accepted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  declined: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  expired: "bg-slate-700/50 text-slate-300 border-slate-600/40",
};

export function getQuoteStatusLabel(status: string | null | undefined): string {
  return STATUS_LABELS[String(status ?? "draft").toLowerCase()] ?? titleCaseStatus(String(status ?? "draft"));
}

export function renderContactName(item: Pick<QuoteListItem, "contact_name" | "customer_name">): string {
  return item.contact_name?.trim() || item.customer_name?.trim() || "No contact";
}

export function isMissingContact(item: Pick<QuoteListItem, "contact_name" | "customer_name">): boolean {
  return !item.contact_name?.trim() && !item.customer_name?.trim();
}

export function getDefaultQuoteSort(): QuoteSort {
  return { key: "updated", direction: "desc" };
}

export function computeStats(items: QuoteListItem[], now: Date = new Date()): Stats {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let open = 0;
  let pipelineValue = 0;
  let winsThisMonth = 0;
  let winsValueMTD = 0;

  for (const item of items) {
    if (!isTerminalStatus(item.status)) open += 1;
    if (PIPELINE_STATUSES.has(item.status)) pipelineValue += item.net_total ?? 0;
    if (item.status === "accepted" && item.accepted_at && new Date(item.accepted_at) >= monthStart) {
      winsThisMonth += 1;
      winsValueMTD += item.net_total ?? 0;
    }
  }

  return {
    total: items.length,
    open,
    pipelineValue,
    winsThisMonth,
    winsValueMTD,
  };
}

export function applyStatFilters(items: QuoteListItem[], activeFilters: Set<QuoteStatFilter>, now: Date = new Date()): QuoteListItem[] {
  if (activeFilters.size === 0) return items;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return items.filter((item) => {
    for (const filter of activeFilters) {
      if (filter === "total") continue;
      if (filter === "open" && isTerminalStatus(item.status)) return false;
      if (filter === "pipeline" && !PIPELINE_STATUSES.has(item.status)) return false;
      if (filter === "wins" && (item.status !== "accepted" || !item.accepted_at || new Date(item.accepted_at) < monthStart)) return false;
    }
    return true;
  });
}

export function sortQuoteItems(items: QuoteListItem[], sort: QuoteSort): QuoteListItem[] {
  return [...items].sort((a, b) => {
    const direction = sort.direction === "asc" ? 1 : -1;
    const left = getSortValue(a, sort.key);
    const right = getSortValue(b, sort.key);
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * direction;
  });
}

export function QuoteListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<QuoteSort>(getDefaultQuoteSort);
  const [activeStatFilters, setActiveStatFilters] = useState<Set<QuoteStatFilter>>(() => new Set(["total"]));
  const [localDrafts, setLocalDrafts] = useState<LocalDraftRecord[]>([]);
  const [showScoringAccuracy, setShowScoringAccuracy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile?.id) {
      setLocalDrafts([]);
      return;
    }
    setLocalDrafts(listLocalDraftsForUser(profile.id));
  }, [profile?.id]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const quotesQuery = useQuery({
    queryKey: ["quote-builder", "list", debouncedSearch],
    queryFn: () => listQuotePackages({ search: debouncedSearch || undefined }),
    staleTime: 10_000,
  });

  const calibrationQuery = useQuery({
    queryKey: ["quote-builder", "scorer-calibration"],
    queryFn: getScorerCalibrationObservations,
    staleTime: 5 * 60 * 1000,
    enabled: showScoringAccuracy,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ quoteId, action }: { quoteId: string; action: QuoteListAction }) => {
      if (action === "resend") {
        await sendQuotePackage(quoteId);
        return;
      }
      if (action === "resume") return;
      await performQuoteListAction({ quotePackageId: quoteId, action });
    },
    onMutate: () => setActionError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quote-builder", "list"] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Quote action failed");
    },
  });

  const allItems = quotesQuery.data?.items ?? [];
  const statusFilteredItems = useMemo(
    () => allItems.filter((item) => status === "all" || normalizeStatusForFilter(item.status) === status),
    [allItems, status],
  );
  const statFilteredItems = useMemo(
    () => applyStatFilters(statusFilteredItems, activeStatFilters),
    [statusFilteredItems, activeStatFilters],
  );
  const sortedItems = useMemo(() => sortQuoteItems(statFilteredItems, sort), [statFilteredItems, sort]);
  const stats = useMemo(() => computeStats(statFilteredItems), [statFilteredItems]);
  const hasNoQuotes = quotesQuery.isSuccess && allItems.length === 0 && !debouncedSearch && status === "all" && activeStatFilters.size === 0;
  const hasFilters = Boolean(debouncedSearch) || status !== "all" || activeStatFilters.size > 0;

  function toggleStatFilter(filter: QuoteStatFilter) {
    setActiveStatFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }

  function handleSort(key: QuoteSortKey) {
    setSort((current) => {
      if (current.key !== key) return { key, direction: key === "updated" ? "desc" : "asc" };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }

  function handleResumeLocalDraft(record: LocalDraftRecord) {
    const params = new URLSearchParams();
    if (record.dealId) params.set("crm_deal_id", record.dealId);
    if (record.contactId) params.set("crm_contact_id", record.contactId);
    navigate(params.toString() ? `/quote-v2?${params.toString()}` : "/quote-v2");
  }

  function handleClearLocalDraft(key: string) {
    clearLocalDraft(key);
    if (profile?.id) setLocalDrafts(listLocalDraftsForUser(profile.id));
  }

  return (
    <div className="relative left-1/2 -mt-8 flex min-h-[calc(100vh-9rem)] w-[min(1500px,calc(100vw-48px))] -translate-x-1/2 flex-col gap-7 rounded-b-2xl border-x border-b border-border/60 bg-background/25 px-10 pb-8 pt-8 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Quotes</h1>
          <p className="mt-1 text-sm text-muted-foreground">All equipment proposals — search, filter, or start a new one.</p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard
          active={activeStatFilters.has("total")}
          icon={List}
          label="Total"
          value={String(stats.total)}
          onClick={() => toggleStatFilter("total")}
        />
        <StatCard
          active={activeStatFilters.has("open")}
          icon={Clock3}
          label="Open"
          value={String(stats.open)}
          onClick={() => toggleStatFilter("open")}
        />
        <StatCard
          active={activeStatFilters.has("pipeline")}
          icon={BarChart3}
          label="Pipeline"
          value={fmtCompactCurrency(stats.pipelineValue)}
          onClick={() => toggleStatFilter("pipeline")}
        />
        <StatCard
          active={activeStatFilters.has("wins")}
          icon={Trophy}
          label="Wins MTD"
          value={String(stats.winsThisMonth)}
          valueClassName="text-qep-orange"
          onClick={() => toggleStatFilter("wins")}
        />
      </section>

      {localDrafts.length > 0 && (
        <LocalDraftsSection
          drafts={localDrafts}
          onResume={handleResumeLocalDraft}
          onClear={handleClearLocalDraft}
        />
      )}

      <Card className="overflow-hidden rounded-lg border-border/70 bg-card/80">
        <div className="flex flex-col gap-3 border-b border-border/60 p-3 lg:flex-row lg:items-center">
          <div className="relative min-w-[420px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by quote number, customer, or contact"
              className="h-10 pl-9 pr-14"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden h-5 -translate-y-1/2 items-center rounded border border-border bg-muted/50 px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
              ⌘K
            </kbd>
          </div>
          <button
            type="button"
            onClick={() => setShowScoringAccuracy((value) => !value)}
            className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          >
            <BarChart3 className="h-4 w-4 text-qep-orange" />
            View scoring accuracy
          </button>
          <div className="ml-auto flex rounded-lg border border-border/60 bg-muted/20 p-1">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatus(filter)}
                className={`min-w-20 rounded-md px-3 py-2 text-xs font-medium transition ${
                  status === filter
                    ? "bg-muted text-foreground shadow-sm ring-1 ring-qep-orange/40"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {filter === "all" ? "All" : getQuoteStatusLabel(filter)}
              </button>
            ))}
          </div>
        </div>

        {showScoringAccuracy && (
          <ScoringAccuracyPanel
            loading={calibrationQuery.isLoading}
            data={calibrationQuery.data ?? null}
          />
        )}

        {actionError && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {actionError}
          </div>
        )}

        {quotesQuery.isLoading ? (
          <LoadingRows />
        ) : quotesQuery.isError ? (
          <ErrorPanel
            error={quotesQuery.error instanceof Error ? quotesQuery.error.message : "Unknown error"}
            onRetry={() => quotesQuery.refetch()}
          />
        ) : hasNoQuotes ? (
          <EmptyState onNewQuote={() => navigate("/quote-v2")} />
        ) : sortedItems.length === 0 ? (
          <NoMatches onClear={() => {
            setSearch("");
            setDebouncedSearch("");
            setStatus("all");
            setActiveStatFilters(new Set());
          }} />
        ) : (
          <QuoteTable
            items={sortedItems}
            sort={sort}
            actionPendingId={actionMutation.variables?.quoteId ?? null}
            actionPending={actionMutation.isPending}
            hasFilters={hasFilters}
            onSort={handleSort}
            onOpen={(item) => navigate(`/quote-v2?${new URLSearchParams({ package_id: item.id }).toString()}`)}
            onAction={(quoteId, action) => {
              if (action === "resume") {
                const item = sortedItems.find((row) => row.id === quoteId);
                if (item) navigate(`/quote-v2?${new URLSearchParams({ package_id: item.id }).toString()}`);
                return;
              }
              actionMutation.mutate({ quoteId, action });
            }}
          />
        )}
      </Card>
    </div>
  );
}

function QuoteTable({
  items,
  sort,
  actionPendingId,
  actionPending,
  hasFilters: _hasFilters,
  onSort,
  onOpen,
  onAction,
}: {
  items: QuoteListItem[];
  sort: QuoteSort;
  actionPendingId: string | null;
  actionPending: boolean;
  hasFilters: boolean;
  onSort: (key: QuoteSortKey) => void;
  onOpen: (item: QuoteListItem) => void;
  onAction: (quoteId: string, action: QuoteListAction) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1220px] table-fixed">
        <thead className="border-b border-border/60 bg-muted/10">
          <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <SortableHeader label="Quote" column="quote" sort={sort} onSort={onSort} className="w-[20%]" />
            <SortableHeader label="Customer & Contact" column="customer" sort={sort} onSort={onSort} className="w-[24%]" />
            <SortableHeader label="Equipment" column="equipment" sort={sort} onSort={onSort} className="w-[17%]" />
            <SortableHeader label="Total" column="total" sort={sort} onSort={onSort} className="w-[9%]" />
            <SortableHeader
              label={
                <span className="inline-flex items-center gap-1">
                  Deal Score
                  <span className="group/info relative inline-flex">
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-64 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-left text-xs normal-case tracking-normal text-popover-foreground shadow-xl group-hover/info:block">
                      Score blends quote fit, customer signal, pricing strength, and follow-up timing into a win-probability indicator.
                    </span>
                  </span>
                </span>
              }
              column="score"
              sort={sort}
              onSort={onSort}
              className="w-[10%]"
            />
            <SortableHeader label="Updated" column="updated" sort={sort} onSort={onSort} className="w-[20%]" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <QuoteRow
              key={item.id}
              item={item}
              actionPending={actionPending && actionPendingId === item.id}
              onOpen={() => onOpen(item)}
              onAction={(action) => onAction(item.id, action)}
            />
          ))}
        </tbody>
      </table>
      <div className="border-t border-border/60 px-4 py-4 text-center text-xs text-muted-foreground">
        Showing {items.length} of {items.length} quotes
      </div>
    </div>
  );
}

function QuoteRow({
  item,
  actionPending,
  onOpen,
  onAction,
}: {
  item: QuoteListItem;
  actionPending: boolean;
  onOpen: () => void;
  onAction: (action: QuoteListAction) => void;
}) {
  const statusLabel = getQuoteStatusLabel(item.status);
  const statusKey = normalizeStatusForChip(item.status);
  const quickActions = quickActionsForStatus(item.status);

  return (
    <tr
      className="group cursor-pointer border-b border-border/50 bg-card/40 transition hover:bg-muted/20"
      onClick={onOpen}
    >
      <td className="px-5 py-5 align-middle">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/40">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{item.quote_number ?? "Unnumbered quote"}</div>
            <Badge className={`mt-1 border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${STATUS_CHIP_CLASSES[statusKey]}`}>
              {statusLabel}
            </Badge>
          </div>
        </div>
      </td>
      <td className="px-5 py-5 align-middle">
        <div className="space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-foreground">{item.customer_company || item.customer_name || "Unnamed customer"}</span>
          </div>
          <div className={`flex min-w-0 items-center gap-2 text-sm ${isMissingContact(item) ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
            <User className="h-4 w-4 shrink-0" />
            <span className="truncate">{renderContactName(item)}</span>
          </div>
        </div>
      </td>
      <td className="px-5 py-5 align-middle">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="line-clamp-2 text-sm text-foreground">{item.equipment_summary || "No equipment"}</span>
        </div>
      </td>
      <td className="px-5 py-5 align-middle">
        <div className="text-sm font-semibold tabular-nums text-foreground">{fmtCurrency(item.net_total)}</div>
      </td>
      <td className="px-5 py-5 align-middle">
        <div className="text-base font-bold tabular-nums text-qep-orange">
          {typeof item.win_probability_score === "number" ? item.win_probability_score : "—"}
        </div>
      </td>
      <td className="px-5 py-5 align-middle">
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-2 text-sm text-muted-foreground group-hover:hidden">
            <span>{formatDate(item.updated_at ?? item.created_at)}</span>
            <ChevronRight className="h-4 w-4" />
          </div>
          <div className="hidden items-center justify-end gap-1 group-hover:flex">
            {quickActions.map((action) => (
              <button
                key={action.action}
                type="button"
                disabled={actionPending}
                onClick={(event) => {
                  event.stopPropagation();
                  onAction(action.action);
                }}
                className="inline-flex h-10 min-w-16 flex-col items-center justify-center gap-0.5 rounded-md border border-border/50 bg-muted/30 px-2 text-[10px] text-muted-foreground transition hover:border-qep-orange/50 hover:bg-qep-orange/10 hover:text-qep-orange disabled:cursor-not-allowed disabled:opacity-50"
                title={action.label}
              >
                <action.icon className={`h-4 w-4 ${actionPending ? "animate-pulse" : ""}`} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

function SortableHeader({
  label,
  column,
  sort,
  className,
  onSort,
}: {
  label: React.ReactNode;
  column: QuoteSortKey;
  sort: QuoteSort;
  className?: string;
  onSort: (column: QuoteSortKey) => void;
}) {
  const active = sort.key === column;
  return (
    <th className={`px-5 py-4 font-medium ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 transition hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        <ChevronDown
          className={`h-3.5 w-3.5 transition ${active ? "text-qep-orange" : "text-muted-foreground/50"} ${active && sort.direction === "asc" ? "rotate-180" : ""}`}
        />
      </button>
    </th>
  );
}

function StatCard({
  active,
  icon: Icon,
  label,
  value,
  valueClassName,
  onClick,
}: {
  active: boolean;
  icon: typeof List;
  label: string;
  value: string;
  valueClassName?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[128px] rounded-lg border bg-card/80 p-5 text-left transition hover:border-qep-orange/60 hover:bg-card ${
        active ? "border-qep-orange shadow-[0_0_0_1px_rgba(249,115,22,0.45)]" : "border-border/70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className={`mt-2 text-2xl font-bold text-foreground ${valueClassName ?? ""}`}>{value}</div>
          <div className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </button>
  );
}

function LocalDraftsSection({
  drafts,
  onResume,
  onClear,
}: {
  drafts: LocalDraftRecord[];
  onResume: (record: LocalDraftRecord) => void;
  onClear: (key: string) => void;
}) {
  return (
    <Card className="border-border/70 bg-card/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-qep-orange">
          <Pencil className="h-4 w-4" />
          Unsaved Drafts
        </div>
        <Badge variant="outline" className="border-border/70 text-muted-foreground">This device only</Badge>
      </div>
      <div className="space-y-2">
        {drafts.map((record) => {
          const name = record.draft.customerName?.trim() || record.draft.customerCompany?.trim() || "Untitled draft";
          const equipmentCount = record.draft.equipment?.length ?? 0;
          const firstEquip = record.draft.equipment?.[0];
          const equipmentLabel = firstEquip
            ? [firstEquip.make, firstEquip.model].filter(Boolean).join(" ") || firstEquip.title || "Equipment selected"
            : "No equipment yet";
          return (
            <div key={record.key} className="flex min-h-[74px] items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/40 px-5 py-3">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted/60 text-sm font-semibold text-foreground">
                  {initialsForName(name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{name}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {equipmentLabel}{equipmentCount > 1 ? ` +${equipmentCount - 1} more` : ""}
                    {record.savedAt ? ` · Last edited ${new Date(record.savedAt).toLocaleString()}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-qep-orange/50 text-qep-orange hover:bg-qep-orange/10" onClick={() => onResume(record)}>Resume</Button>
                <Button size="sm" variant="outline" onClick={() => onClear(record.key)}>Discard</Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ScoringAccuracyPanel({
  loading,
  data,
}: {
  loading: boolean;
  data: Awaited<ReturnType<typeof getScorerCalibrationObservations>> | null;
}) {
  if (loading || !data) {
    return (
      <div className="border-b border-border/60 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
        Loading scoring accuracy…
      </div>
    );
  }
  if (!data.ok) {
    return (
      <div className="border-b border-border/60 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
        {data.reason === "forbidden" ? "Scoring accuracy is available to managers and owners." : data.message}
      </div>
    );
  }
  const report = computeCalibrationReport(data.observations);
  return (
    <div className="border-b border-border/60 bg-muted/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-semibold text-foreground">Scoring accuracy</span>
        <span className="text-muted-foreground">Sample {report.sampleSize}</span>
        <span className="text-muted-foreground">Accuracy {formatPct(report.accuracyPct)}</span>
        {report.brierScore != null && <span className="text-muted-foreground">Brier {report.brierScore.toFixed(3)}</span>}
        {report.lowConfidence && <span className="text-amber-300">Small sample</span>}
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2 p-4" aria-busy="true">
      {[1, 2, 3].map((row) => (
        <div key={row} className="h-16 animate-pulse rounded-lg bg-muted/40" />
      ))}
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-3 p-6">
      <XCircle className="mt-0.5 h-5 w-5 text-red-400" />
      <div>
        <div className="text-sm font-semibold text-red-300">Couldn't load quotes</div>
        <div className="mt-1 text-sm text-muted-foreground">{error}</div>
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ onNewQuote }: { onNewQuote: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="relative mb-5 h-24 w-24 rounded-2xl border border-qep-orange/30 bg-qep-orange/10">
        <FileText className="absolute left-7 top-6 h-10 w-10 text-qep-orange" />
        <Send className="absolute bottom-5 right-5 h-5 w-5 text-qep-orange" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">Start your first quote</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">Create an equipment proposal, track its status, and keep every follow-up in one place.</p>
      <Button onClick={onNewQuote} className="mt-5 bg-qep-orange text-white hover:bg-qep-orange/90">
        <Plus className="mr-2 h-4 w-4" />
        Start your first quote
      </Button>
    </div>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <Search className="h-10 w-10 text-muted-foreground/50" />
      <h2 className="mt-3 text-sm font-semibold text-foreground">No quotes match your filters</h2>
      <p className="mt-1 text-sm text-muted-foreground">Clear filters or search for a different customer, contact, or quote number.</p>
      <Button size="sm" variant="outline" className="mt-4" onClick={onClear}>Clear filters</Button>
    </div>
  );
}

function quickActionsForStatus(status: string): Array<{ action: QuoteListAction; label: string; icon: typeof Mail }> {
  if (status === "draft") {
    return [
      { action: "resume", label: "Resume", icon: Pencil },
      { action: "duplicate", label: "Duplicate", icon: Copy },
      { action: "discard", label: "Discard", icon: Trash2 },
    ];
  }
  if (status === "sent" || status === "pending_approval") {
    return [
      { action: "resend", label: "Resend", icon: Send },
      { action: "duplicate", label: "Duplicate", icon: Copy },
      { action: "mark_sent", label: "Mark Sent", icon: Check },
      { action: "archive", label: "Archive", icon: Archive },
    ];
  }
  return [
    { action: "duplicate", label: "Duplicate", icon: Copy },
    { action: "archive", label: "Archive", icon: Archive },
  ];
}

function titleCaseStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeStatusForFilter(status: string): (typeof STATUS_FILTERS)[number] {
  if (status === "approved" || status === "approved_with_conditions") return "ready";
  if (status === "viewed") return "sent";
  if (status === "changes_requested") return "draft";
  if (status === "draft" || status === "ready" || status === "sent" || status === "accepted") return status;
  return "all";
}

function normalizeStatusForChip(status: string): string {
  const label = getQuoteStatusLabel(status).toLowerCase().replace(/\s+/g, "_");
  if (label === "pending_approval") return "pending_approval";
  return label;
}

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

function getSortValue(item: QuoteListItem, key: QuoteSortKey): string | number {
  if (key === "quote") return item.quote_number ?? "";
  if (key === "customer") return item.customer_company || item.customer_name || "";
  if (key === "equipment") return item.equipment_summary ?? "";
  if (key === "total") return item.net_total ?? 0;
  if (key === "score") return item.win_probability_score ?? -1;
  return new Date(item.updated_at ?? item.created_at).getTime() || 0;
}

function fmtCurrency(amount: number | null): string {
  if (amount == null) return "—";
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtCompactCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}k`;
  return `$${amount.toLocaleString("en-US")}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Q";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "Q";
}
