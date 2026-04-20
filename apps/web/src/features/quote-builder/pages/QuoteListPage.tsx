import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Search, FileText, Mic, MessageSquare,
  AlertTriangle, RotateCcw, Sparkles, Gauge,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, AlertOctagon,
  Target, Check, X, Clock,
} from "lucide-react";
import {
  listQuotePackages,
  getScorerCalibrationObservations,
  getFactorAttributionDeals,
  getClosedDealsAudit,
} from "../lib/quote-api";
import { OutcomeCaptureDrawer } from "../components/OutcomeCaptureDrawer";
import {
  calibrationHeadline,
  computeCalibrationReport,
  formatPct,
  type BandCalibration,
  type CalibrationReport,
} from "../lib/scorer-calibration";
import {
  computeFactorAttribution,
  isFactorSurprising,
  type FactorAttribution,
  type FactorAttributionReport,
} from "../lib/factor-attribution";
import {
  computeClosedDealsAudit,
  formatAuditSummary,
  MISS_THRESHOLD,
  type ClosedDealAudit,
} from "../lib/closed-deals-audit";
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

/**
 * Slice 20e: win-probability band thresholds — must match the inline
 * ternary in `computeWinProbability` inside win-probability-scorer.ts.
 * We mirror the mapping here instead of importing it so the list page
 * doesn't pull in the scorer module just to color a pill. If the scorer
 * thresholds change, update both sites.
 *   score >= 70 → strong   (emerald)
 *   score >= 55 → healthy  (sky)
 *   score >= 35 → mixed    (amber)
 *   score <  35 → at_risk  (rose)
 */
function scoreBandStyle(score: number): { ring: string; text: string; bg: string; label: string } {
  if (score >= 70) return { ring: "ring-emerald-500/30", text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", label: "On pace" };
  if (score >= 55) return { ring: "ring-sky-500/30",     text: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/30",     label: "Healthy" };
  if (score >= 35) return { ring: "ring-amber-500/30",   text: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/30", label: "Mixed"   };
  return             { ring: "ring-rose-500/30",    text: "text-rose-400",    bg: "bg-rose-500/10 border-rose-500/30",    label: "At risk" };
}

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

  // Slice 20f: scorer calibration. Pulls the full (score × outcome)
  // observation set once and derives the report client-side so the
  // card can be restructured without another round trip.
  //
  // The query resolves to a discriminated union — forbidden (rep role)
  // and error (500/network) are NOT thrown, so retries won't happen
  // for those paths. 5-minute stale time because calibration changes
  // on closed-deal timescale, not minute timescale.
  const calibrationQuery = useQuery({
    queryKey: ["quote-builder", "scorer-calibration"],
    queryFn: getScorerCalibrationObservations,
    staleTime: 5 * 60 * 1000,
  });

  /**
   * Three display states for the card:
   *   - null                   → don't render anything (rep role / still loading).
   *   - { kind: "report", … }  → show the calibration numbers.
   *   - { kind: "error", … }   → show a compact error row so a broken
   *     endpoint doesn't silently disappear for managers.
   */
  const calibrationDisplay = useMemo<
    | null
    | { kind: "report"; report: CalibrationReport }
    | { kind: "error"; message: string }
  >(() => {
    const r = calibrationQuery.data;
    if (!r) return null;
    if (!r.ok) {
      if (r.reason === "forbidden") return null; // reps see no card
      return { kind: "error", message: r.message };
    }
    return { kind: "report", report: computeCalibrationReport(r.observations) };
  }, [calibrationQuery.data]);

  /**
   * Slice 20h: closed-deals audit query. Same role-gate pattern as
   * calibration — reps see nothing (forbidden → null), managers see
   * either a broken-endpoint hint or the sorted worst-misses card.
   *
   * Tradeoff: we intentionally couple the audit query's `enabled` flag
   * to the calibration query's success so a rep doesn't fire a second
   * 403. The downside is that if `/scorer-calibration` ever returns
   * a non-forbidden failure (500, network, etc.), managers lose the
   * audit card too. That's acceptable — both cards share auth + data
   * lineage, so a failure in one is highly likely to be reflected in
   * the other, and coupled failure is clearer than half-failure.
   */
  const closedAuditEnabled = calibrationQuery.data?.ok === true;
  const closedAuditQuery = useQuery({
    queryKey: ["quote-builder", "closed-deals-audit"],
    queryFn: getClosedDealsAudit,
    staleTime: 5 * 60 * 1000,
    enabled: closedAuditEnabled,
  });
  const closedAuditDisplay = useMemo<
    | null
    | { kind: "audits"; audits: ClosedDealAudit[] }
    | { kind: "error"; message: string }
  >(() => {
    const r = closedAuditQuery.data;
    if (!r) return null;
    if (!r.ok) {
      if (r.reason === "forbidden") return null;
      return { kind: "error", message: r.message };
    }
    const audits = computeClosedDealsAudit(r.audits);
    if (audits.length === 0) return null;
    return { kind: "audits", audits };
  }, [closedAuditQuery.data]);

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

      {/* Slice 20f: scorer calibration card — manager/owner only.
          Rendered above the filter row. Three display states:
            - loading / forbidden (rep): nothing rendered
            - error: compact row so a broken endpoint is visible
            - data: the full calibration card */}
      {calibrationDisplay?.kind === "report" && (
        <ScorerCalibrationCard report={calibrationDisplay.report} />
      )}
      {calibrationDisplay?.kind === "error" && (
        <InstrumentationErrorRow label="Scorer calibration" message={calibrationDisplay.message} />
      )}

      {/* Slice 20h: closed-deals audit — manager/owner only, rendered
          below the calibration card. Hidden for reps (forbidden) and
          when no closed-deal audits exist yet (empty). */}
      {closedAuditDisplay?.kind === "audits" && (
        <ClosedDealsAuditCard audits={closedAuditDisplay.audits} />
      )}
      {closedAuditDisplay?.kind === "error" && (
        <InstrumentationErrorRow label="Closed-deals audit" message={closedAuditDisplay.message} />
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
        <div className="flex flex-col items-end shrink-0 gap-1">
          <p className="text-sm font-bold text-foreground">{fmtCurrency(item.net_total)}</p>
          <WinProbabilityPill score={item.win_probability_score} />
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

/**
 * Slice 20f — scorer calibration card. This is the baseline
 * instrumentation for Move 2 (counterfactual win-probability engine).
 * Before any ML model ships, we want to know: "how often is the
 * rule-based scorer right today?" Everything downstream is measured
 * against this number.
 *
 * Why a card on the list page instead of its own admin dashboard:
 * managers already open the list to triage pipeline — putting the
 * calibration at the top means they see the baseline *every day*
 * without a separate nav. When the ML model ships, this card swaps
 * its data source seamlessly.
 *
 * Design bar: *transparent over confident*. We never hide the sample
 * size; we never round away a low-confidence warning. Per-band win
 * rates are shown in a mini-strip so reps can see where the scorer is
 * miscalibrated at a glance.
 */
function ScorerCalibrationCard({ report }: { report: CalibrationReport }) {
  const headline = calibrationHeadline(report);
  const hasData = report.sampleSize > 0;
  // Slice 20g: factor attribution breakdown is gated behind an
  // expansion toggle. Collapsed by default so the card stays scannable
  // for the daily triage case; expansion lazy-loads the jsonb-heavy
  // factor data only when the manager actually wants the audit view.
  const [expanded, setExpanded] = useState(false);
  return (
    <Card
      className={`border p-3 ${hasData ? "border-sky-500/30 bg-sky-500/5" : "border-border bg-muted/10"}`}
      role="region"
      aria-label="Win-probability scorer calibration"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-full bg-sky-500/10 p-2">
          <Gauge className="h-4 w-4 text-sky-400" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">
              Scorer calibration
            </div>
            {hasData && (
              <div
                className="text-[10px] text-muted-foreground"
                title="Brier score = mean squared error between predicted probability and binary outcome. Lower is better. 0.25 = coin flip."
                aria-label={`Brier score ${report.brierScore!.toFixed(3)} — mean squared error between predicted probability and actual outcome. Lower is better; 0.25 is coin-flip baseline.`}
              >
                Brier {report.brierScore!.toFixed(3)}
              </div>
            )}
          </div>
          <p className="mt-0.5 text-sm text-foreground">{headline}</p>
          {hasData && (
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {report.bands.map((b) => (
                <CalibrationBandCell key={b.band} band={b} />
              ))}
            </div>
          )}
          {report.lowConfidence && hasData && (
            <p
              className="mt-2 text-[11px] text-amber-400"
              title="We need at least 10 closed deals with a saved win-probability score before the aggregate number is reliable."
            >
              Small sample — capture more outcomes to tighten this.
            </p>
          )}

          {/* Slice 20g: expandable factor audit. Only offered when the
              aggregate already has at least one closed-deal observation
              — no point showing "which factors matter?" before any
              factors have had a chance to be judged by reality. */}
          {hasData && (
            <div className="mt-3 border-t border-sky-500/20 pt-2">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500/50 rounded"
                aria-expanded={expanded}
                aria-controls="scorer-factor-breakdown"
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3" aria-hidden />
                ) : (
                  <ChevronRight className="h-3 w-3" aria-hidden />
                )}
                {expanded ? "Hide factor breakdown" : "Show factor breakdown"}
              </button>
              {expanded && (
                <div id="scorer-factor-breakdown" className="mt-2">
                  <FactorAttributionPanel />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Slice 20g — factor attribution panel.
 *
 * Lazy-mounted inside the scorer calibration card expansion. Owns its
 * own query (fires only on expand) and its own derived report so the
 * parent card doesn't pay the jsonb download cost unless the manager
 * actually wants to audit the rules.
 *
 * What it shows:
 *   - Top 5 factors by absolute lift, each with a signed delta showing
 *     "deals-with-this-factor win %" vs. "deals-without win %".
 *   - Surprising factors (scorer weight disagrees with reality) get a
 *     warning icon — these are the rules to review for the next
 *     scorer-evolution PR.
 *   - Low-confidence rows render at reduced opacity with an "(n=X)"
 *     annotation so the reader can weight them appropriately.
 */
function FactorAttributionPanel() {
  const factorsQuery = useQuery({
    queryKey: ["quote-builder", "factor-attribution"],
    queryFn: getFactorAttributionDeals,
    staleTime: 5 * 60 * 1000,
  });
  const report: FactorAttributionReport | null = useMemo(() => {
    const r = factorsQuery.data;
    if (!r || !r.ok) return null;
    return computeFactorAttribution(r.deals);
  }, [factorsQuery.data]);

  if (factorsQuery.isLoading) {
    return (
      <p className="text-[11px] text-muted-foreground" aria-live="polite">
        Loading factor breakdown…
      </p>
    );
  }
  if (factorsQuery.data && !factorsQuery.data.ok) {
    // Forbidden should never fire here — the parent ScorerCalibrationCard
    // only mounts when calibrationQuery already passed the same role
    // check — but if the two endpoints ever diverge on role gating, we
    // still want the rep-facing fail mode to be a clean hide, not a
    // permissions-error leak. Real errors still render as an amber hint.
    if (factorsQuery.data.reason === "forbidden") return null;
    return (
      <p className="text-[11px] text-amber-400" role="status" aria-live="polite">
        Couldn't load factor breakdown — {factorsQuery.data.message}
      </p>
    );
  }
  if (!report || report.dealsAnalyzed === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        No closed deals with a saved snapshot yet — factor attribution fills in as outcomes are captured.
      </p>
    );
  }
  const topFactors = report.factors.slice(0, 5);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">
          Top factors by lift
        </span>
        <span className="text-[10px] text-muted-foreground">
          {report.dealsAnalyzed} deal{report.dealsAnalyzed === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="mt-1 space-y-1">
        {topFactors.map((f) => (
          <FactorAttributionRow key={f.label} f={f} />
        ))}
      </ul>
      {report.factors.length > topFactors.length && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          +{report.factors.length - topFactors.length} more factors with weaker or null lift
        </p>
      )}
    </div>
  );
}

function FactorAttributionRow({ f }: { f: FactorAttribution }) {
  const surprising = isFactorSurprising(f);
  const liftPct =
    f.lift === null ? "—" : `${f.lift > 0 ? "+" : ""}${(f.lift * 100).toFixed(0)} pts`;
  const Icon = f.lift === null ? null : f.lift > 0 ? TrendingUp : TrendingDown;
  const color =
    f.lift === null
      ? "text-muted-foreground"
      : f.lift > 0
        ? "text-emerald-400"
        : "text-rose-400";
  const presentPct = formatPct(f.winRateWhenPresent);
  const absentPct = formatPct(f.winRateWhenAbsent);
  // A11y note: aria-label on bare <li> is inconsistently honored across
  // screen readers. Wrap the visible content in a role="group" span,
  // which universally takes aria-label as its accessible name while
  // leaving the <li>'s implicit listitem role intact.
  const ariaSummary =
    `${f.label}: win rate when present ${presentPct}, when absent ${absentPct}, lift ${liftPct}` +
    (f.lowConfidence ? " (low confidence)" : "") +
    (surprising ? ". Surprising: scorer weight disagrees with observed lift." : "");
  return (
    <li className={`${f.lowConfidence ? "opacity-60" : ""}`}>
      <span role="group" aria-label={ariaSummary} className="flex items-center gap-2 text-[11px]">
        {Icon ? (
          <Icon className={`h-3 w-3 ${color}`} aria-hidden />
        ) : (
          <span className="inline-block h-3 w-3" aria-hidden />
        )}
        <span className={`tabular-nums font-semibold w-16 text-right ${color}`}>{liftPct}</span>
        <span className="flex-1 truncate text-foreground" title={f.label}>
          {f.label}
        </span>
        <span className="text-muted-foreground tabular-nums whitespace-nowrap">
          {presentPct}/{absentPct}
        </span>
        <span className="text-muted-foreground text-[10px] whitespace-nowrap">
          n={f.present}
        </span>
        {surprising && (
          // Accessible name is already carried by the parent group's
          // aria-label ("Surprising: …"). The icon is decorative here;
          // title stays for sighted hover affordance.
          <span
            title="Surprising: scorer weight disagrees with observed lift. Review this rule's weight."
            aria-hidden="true"
            className="inline-flex items-center"
          >
            <AlertOctagon className="h-3 w-3 text-amber-400" />
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Compact error row shown to managers/owners when an instrumentation
 * endpoint fails. Intentionally subtle — we don't want to block the
 * quote list, we just want to surface that an instrumentation surface
 * broke rather than let it silently vanish. `label` is the surface
 * name ("Scorer calibration", "Closed-deals audit") so one shared
 * component handles every manager-only error state.
 */
function InstrumentationErrorRow({
  label = "Scorer calibration",
  message,
}: {
  label?: string;
  message: string;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-300"
      role="status"
      aria-live="polite"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate" title={message}>
        {label} unavailable — {message}
      </span>
    </div>
  );
}
/**
 * Slice 20h — closed-deals audit card.
 *
 * Manager/owner-only triage queue: shows the top 5 closed deals ranked
 * by |delta| (predicted probability vs. realized outcome). These are
 * the rows where the scorer was most wrong — the natural starting
 * point for a scorer-evolution PR.
 *
 * Each row is expandable to its stored top factors, so managers can
 * read the rule-list that drove a misread call without leaving the
 * page. Package ID (truncated) + capture date are enough to pivot to
 * the deal detail if deeper inspection is needed.
 */
function ClosedDealsAuditCard({ audits }: { audits: ClosedDealAudit[] }) {
  const top = audits.slice(0, 5);
  const missCount = audits.filter((a) => a.missed).length;
  return (
    <Card
      className="border-rose-500/30 bg-rose-500/5 p-3"
      role="region"
      aria-label="Closed-deals audit"
    >
      <div className="flex items-start gap-2">
        <Target className="h-4 w-4 shrink-0 text-rose-400" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-400">
              Worst scorer misses
            </span>
            <span
              className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap"
              aria-label={`${audits.length} closed deals analyzed, ${missCount} missed by ${MISS_THRESHOLD}+ points`}
            >
              {audits.length} deal{audits.length === 1 ? "" : "s"} · {missCount} missed
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Review these rows when the scorer-evolution PR lands —
            they're the deals where predicted probability disagreed
            most with realized outcome.
          </p>
          <ul className="mt-2 space-y-1">
            {top.map((a) => (
              <ClosedDealAuditRow key={a.packageId} audit={a} />
            ))}
          </ul>
          {audits.length > top.length && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              +{audits.length - top.length} more audited deals with smaller misses
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function outcomeIconFor(outcome: "won" | "lost" | "expired") {
  if (outcome === "won") return { Icon: Check, tone: "text-emerald-400", word: "Won" };
  if (outcome === "lost") return { Icon: X, tone: "text-rose-400", word: "Lost" };
  return { Icon: Clock, tone: "text-muted-foreground", word: "Expired" };
}

function ClosedDealAuditRow({ audit }: { audit: ClosedDealAudit }) {
  const [expanded, setExpanded] = useState(false);
  const { Icon: OutcomeIcon, tone: outcomeTone, word: outcomeWord } = outcomeIconFor(audit.outcome);
  // Last 8 hex chars of the UUID — birthday collision odds on ~100
  // rendered rows are negligible, vs ~0.03% at 6 chars.
  const pkgShort = audit.packageId.slice(-8);
  const deltaLabel =
    audit.delta === 0
      ? "on target"
      : `${audit.delta > 0 ? "+" : ""}${audit.delta}`;
  const deltaTone = audit.missed
    ? "text-rose-400"
    : audit.delta === 0
      ? "text-muted-foreground"
      : "text-amber-400";
  const summary = formatAuditSummary(audit);
  const panelId = `audit-factors-${audit.packageId}`;
  return (
    <li className="rounded border border-rose-500/20 bg-background/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] focus:outline-none focus:ring-2 focus:ring-rose-500/50 rounded"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={summary}
      >
        {/* Visible content is duplicated by the button's aria-label, so
            mark it aria-hidden to prevent screen readers from reading
            both the summary and the column soup. Same pattern as
            CalibrationBandCell. */}
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="flex flex-1 items-center gap-2" aria-hidden="true">
          <OutcomeIcon className={`h-3 w-3 shrink-0 ${outcomeTone}`} />
          <span className={`tabular-nums font-semibold w-10 text-right ${outcomeTone}`}>
            {outcomeWord}
          </span>
          <span className="tabular-nums text-muted-foreground whitespace-nowrap">
            said {audit.predicted}%
          </span>
          <span className={`tabular-nums font-semibold whitespace-nowrap ${deltaTone}`}>
            Δ {deltaLabel}
          </span>
          <span className="flex-1 truncate text-muted-foreground text-[10px] text-right">
            …{pkgShort}
          </span>
        </span>
      </button>
      {expanded && (
        <div id={panelId} className="border-t border-rose-500/20 px-2 py-1.5">
          {audit.topFactors.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              No factor list stored with this snapshot.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {audit.topFactors.map((f) => {
                const sign = f.weight > 0 ? "+" : "";
                const tone =
                  f.weight > 0
                    ? "text-emerald-400"
                    : f.weight < 0
                      ? "text-rose-400"
                      : "text-muted-foreground";
                return (
                  <li
                    key={f.label}
                    className="flex items-center gap-2 text-[10px]"
                  >
                    <span className={`tabular-nums font-semibold w-10 text-right ${tone}`}>
                      {sign}
                      {f.weight}
                    </span>
                    <span className="truncate text-foreground" title={f.label}>
                      {f.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {audit.capturedAt && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Outcome captured{" "}
              <time dateTime={audit.capturedAt}>
                {new Date(audit.capturedAt).toLocaleDateString()}
              </time>
            </p>
          )}
        </div>
      )}
    </li>
  );
}

const BAND_DISPLAY: Record<
  BandCalibration["band"],
  { label: string; accent: string; bg: string }
> = {
  strong:  { label: "Strong",  accent: "text-emerald-400", bg: "bg-emerald-500/5 border-emerald-500/20" },
  healthy: { label: "Healthy", accent: "text-sky-400",     bg: "bg-sky-500/5 border-sky-500/20" },
  mixed:   { label: "Mixed",   accent: "text-amber-400",   bg: "bg-amber-500/5 border-amber-500/20" },
  at_risk: { label: "At risk", accent: "text-rose-400",    bg: "bg-rose-500/5 border-rose-500/20" },
};

function CalibrationBandCell({ band }: { band: BandCalibration }) {
  const style = BAND_DISPLAY[band.band];
  const winPct = formatPct(band.winRate);
  const detail =
    band.n === 0
      ? `No closed deals in the ${style.label.toLowerCase()} band yet.`
      : `${band.n} deals · ${band.won} won · ${band.lost} lost — empirical win rate ${winPct}.`;
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${style.bg}`}
      title={detail}
      role="group"
      aria-label={`${style.label} band: ${detail}`}
    >
      <div className={`text-[10px] uppercase tracking-wide ${style.accent}`} aria-hidden>
        {style.label}
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-xs font-bold text-foreground tabular-nums" aria-hidden>
          {winPct}
        </span>
        <span className="text-[10px] text-muted-foreground" aria-hidden>
          n={band.n}
        </span>
      </div>
    </div>
  );
}

/**
 * Slice 20e: compact band pill on each quote row. Null-safe — legacy
 * rows saved before migration 311 render "— · WP" so the rep can still
 * distinguish "no score" from "low score" at a glance.
 */
function WinProbabilityPill({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground"
        title="No win-probability score — quote predates Slice 20e snapshot persistence"
      >
        <Gauge className="h-2.5 w-2.5" aria-hidden />
        <span className="font-mono">—</span>
      </span>
    );
  }
  const style = scoreBandStyle(score);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text}`}
      title={`${style.label} · win probability ${score}/100`}
      aria-label={`Win probability: ${score} out of 100 (${style.label})`}
    >
      <Gauge className="h-2.5 w-2.5" aria-hidden />
      <span className="tabular-nums">{score}</span>
    </span>
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
