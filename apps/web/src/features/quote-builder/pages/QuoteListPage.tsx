import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Search, FileText, Mic, MessageSquare,
  AlertTriangle, RotateCcw, Sparkles,
} from "lucide-react";
import { listQuotePackages } from "../lib/quote-api";
import { OutcomeCaptureDrawer } from "../components/OutcomeCaptureDrawer";
import type { QuoteListItem } from "../../../../../../shared/qep-moonshot-contracts";

/**
 * Quote list page — the rep's home base for every open + closed quote.
 *
 * Panels, top to bottom:
 *   1. Header + "New Quote" primary CTA.
 *   2. Stats ribbon (count, open, pipeline $, wins this month) — aggregates
 *      are computed client-side from the loaded set, so filters narrow
 *      them naturally.
 *   3. Search + status filter pills.
 *   4. Skeleton / error / empty-state / data — exactly one renders, never
 *      overlapping (earlier revision rendered error AND empty together).
 *   5. Quote cards with entry-mode icon, status, net total, and
 *      "Record outcome →" on sent/viewed states.
 */

const STATUS_FILTERS = ["all", "draft", "ready", "sent", "accepted"] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-blue-500/10 text-blue-400",
  sent: "bg-qep-orange/10 text-qep-orange",
  viewed: "bg-amber-500/10 text-amber-400",
  accepted: "bg-emerald-500/10 text-emerald-400",
  rejected: "bg-red-500/10 text-red-400",
  expired: "bg-muted text-muted-foreground",
};

const ENTRY_ICONS: Record<string, typeof FileText> = {
  voice: Mic,
  ai_chat: MessageSquare,
  manual: FileText,
};

const OPEN_STATUSES = new Set(["draft", "ready", "sent", "viewed"]);
const OPEN_STATES_FOR_OUTCOME = new Set(["sent", "viewed"]);

function fmtCurrency(amount: number | null): string {
  if (amount == null) return "—";
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtCompactCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)     return `$${Math.round(amount / 1_000)}k`;
  return `$${amount.toLocaleString("en-US")}`;
}

export function QuoteListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [outcomeTarget, setOutcomeTarget] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce search input
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); }, []);
  function handleSearch(value: string) {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(value.trim()), 300);
  }

  // Cmd/Ctrl-K focuses the search input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quotesQuery = useQuery({
    queryKey: ["quote-builder", "list", status, debouncedSearch],
    queryFn: () =>
      listQuotePackages({
        status: status !== "all" ? status : undefined,
        search: debouncedSearch || undefined,
      }),
    staleTime: 10_000,
  });

  const items: QuoteListItem[] = quotesQuery.data?.items ?? [];

  const stats = useMemo(() => computeStats(items), [items]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            All equipment proposals — search, filter, or start a new one.
          </p>
        </div>
        <Button onClick={() => navigate("/quote-v2")}>
          <Plus className="mr-1 h-4 w-4" /> New Quote
        </Button>
      </div>

      {/* Stats ribbon — only when we have data to aggregate */}
      {quotesQuery.isSuccess && items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total" value={stats.total.toString()} />
          <Stat label="Open" value={stats.open.toString()} hint="draft · ready · sent · viewed" />
          <Stat label="Pipeline" value={fmtCompactCurrency(stats.pipelineValue)} hint="net total on open" />
          <Stat label="Wins MTD" value={stats.winsThisMonth.toString()} hint={fmtCompactCurrency(stats.winsValueMTD)} emphasis />
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by quote number, customer, or company…"
            className="pl-9 pr-16"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted/40 px-1.5 text-[10px] font-mono text-muted-foreground">
            ⌘K
          </kbd>
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
                status === f
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                  : "border-border text-muted-foreground hover:border-foreground/20"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Exactly one of: loading / error / empty / data renders. The
          earlier revision rendered error AND empty simultaneously —
          the gates below are mutually exclusive now. */}
      {quotesQuery.isLoading ? (
        <LoadingSkeleton />
      ) : quotesQuery.isError ? (
        <ErrorPanel
          error={quotesQuery.error instanceof Error ? quotesQuery.error.message : "Unknown error"}
          onRetry={() => quotesQuery.refetch()}
          isRetrying={quotesQuery.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          hasFilters={Boolean(debouncedSearch) || status !== "all"}
          onNewQuote={() => navigate("/quote-v2")}
          onClearFilters={() => { setStatus("all"); setSearch(""); setDebouncedSearch(""); }}
        />
      ) : (
        items.map((item) => (
          <QuoteCard
            key={item.id}
            item={item}
            onOpen={() => {
              const params = new URLSearchParams({ package_id: item.id });
              navigate(`/quote-v2?${params.toString()}`);
            }}
            onRecordOutcome={() => setOutcomeTarget(item.id)}
          />
        ))
      )}

      <OutcomeCaptureDrawer
        open={outcomeTarget !== null}
        onClose={() => setOutcomeTarget(null)}
        quotePackageId={outcomeTarget}
        triggeredBy={null}
        onSaved={() => quotesQuery.refetch()}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function Stat({
  label, value, hint, emphasis,
}: {
  label: string; value: string; hint?: string; emphasis?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${emphasis ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${emphasis ? "text-emerald-400" : "text-foreground"}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-3 w-64 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function ErrorPanel({ error, onRetry, isRetrying }: { error: string; onRetry: () => void; isRetrying: boolean }) {
  return (
    <Card className="border-red-500/30 bg-red-500/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-400">Couldn't load quotes</p>
          <p className="mt-1 text-xs text-muted-foreground break-words">{error}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            If this persists, check your session (sign out / in again) or contact an admin.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={onRetry}
            disabled={isRetrying}
          >
            <RotateCcw className={`mr-1.5 h-3.5 w-3.5 ${isRetrying ? "animate-spin" : ""}`} />
            {isRetrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EmptyState({
  hasFilters, onNewQuote, onClearFilters,
}: {
  hasFilters: boolean; onNewQuote: () => void; onClearFilters: () => void;
}) {
  if (hasFilters) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">No quotes match your filters</p>
        <p className="text-xs text-muted-foreground">Try broadening your search or changing the status filter.</p>
        <Button variant="outline" size="sm" onClick={onClearFilters} className="mt-1">
          Clear filters
        </Button>
      </Card>
    );
  }
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col items-center text-center">
        <div className="rounded-full bg-qep-orange/10 p-3">
          <Sparkles className="h-6 w-6 text-qep-orange" />
        </div>
        <p className="mt-3 text-sm font-semibold text-foreground">No quotes yet</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Start your first quote — pick how you want to build it. Voice dictation, conversational AI, or manual
          entry all feed into the same quote package.
        </p>
        <div className="mt-4 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-3">
          <EntryModeCard icon={Mic} label="Voice" hint="Speak the job" onClick={() => onNewQuote()} />
          <EntryModeCard icon={MessageSquare} label="AI Chat" hint="Describe the need" onClick={() => onNewQuote()} />
          <EntryModeCard icon={FileText} label="Manual" hint="Pick from catalog" onClick={() => onNewQuote()} />
        </div>
      </div>
    </Card>
  );
}

function EntryModeCard({
  icon: Icon, label, hint, onClick,
}: {
  icon: typeof FileText; label: string; hint: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 text-center transition hover:border-qep-orange/40 hover:bg-qep-orange/5"
    >
      <Icon className="h-5 w-5 text-qep-orange" />
      <span className="text-xs font-semibold text-foreground">{label}</span>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </button>
  );
}

function QuoteCard({
  item, onOpen, onRecordOutcome,
}: {
  item: QuoteListItem; onOpen: () => void; onRecordOutcome: () => void;
}) {
  const EntryIcon = ENTRY_ICONS[item.entry_mode ?? "manual"] ?? FileText;
  return (
    <Card
      className="cursor-pointer p-4 transition hover:border-qep-orange/30"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">
              {item.customer_company || item.customer_name || "Unnamed quote"}
            </p>
            <Badge
              className={`text-[10px] uppercase tracking-wider ${
                STATUS_COLORS[item.status] ?? STATUS_COLORS.draft
              }`}
            >
              {item.status}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            {item.quote_number && <span className="font-mono">{item.quote_number}</span>}
            {item.customer_name && item.customer_company && (
              <span>{item.customer_name}</span>
            )}
            <span className="flex items-center gap-1">
              <EntryIcon className="h-3 w-3" />
              {item.equipment_summary}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-foreground">{fmtCurrency(item.net_total)}</p>
          <p className="text-[10px] text-muted-foreground">
            {new Date(item.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>
      {OPEN_STATES_FOR_OUTCOME.has(item.status) && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRecordOutcome();
            }}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            Record outcome →
          </button>
        </div>
      )}
    </Card>
  );
}

// ── Stats aggregator (pure) ───────────────────────────────────────────────

interface Stats {
  total:           number;
  open:            number;
  pipelineValue:   number;
  winsThisMonth:   number;
  winsValueMTD:    number;
}

/** Exported for future tests; computed client-side over the filtered list. */
export function computeStats(items: QuoteListItem[]): Stats {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let open = 0, pipelineValue = 0, winsThisMonth = 0, winsValueMTD = 0;
  for (const item of items) {
    if (OPEN_STATUSES.has(item.status)) {
      open += 1;
      pipelineValue += item.net_total ?? 0;
    }
    if (item.status === "accepted" && new Date(item.created_at) >= monthStart) {
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
