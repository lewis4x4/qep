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
  Target, Check, X, Clock, Wand2, Copy, CheckCircle2,
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
import {
  computeRetrospectiveShadows,
  computeShadowAgreementSummary,
  describeShadowTrustHeadline,
  type ShadowAgreementSummary,
} from "../lib/retrospective-shadow";
import {
  computeScorerProposal,
  type ScorerProposal,
  type ScorerFactorChange,
} from "../lib/scorer-proposal";
import { renderProposalMarkdownWithContext } from "../lib/proposal-markdown";
import {
  simulateProposalCalibration,
  describeWhatIfHeadline,
  type ScorerWhatIfResult,
} from "../lib/scorer-what-if";
import {
  computeFactorDrift,
  describeDriftHeadline,
  describeDriftRationale,
  type FactorDrift,
  type FactorDriftReport,
} from "../lib/factor-drift";
import {
  computeCalibrationDrift,
  describeCalibrationDriftHeadline,
  formatSignedPct,
  formatBrierDelta,
  type CalibrationDriftReport,
} from "../lib/calibration-drift";
import {
  computeProposalUrgency,
  describeProposalUrgencyPill,
  type ProposalUrgency,
  type ProposalUrgencyResult,
} from "../lib/proposal-urgency";
import {
  computeProposalConfidence,
  describeProposalConfidencePill,
  type ProposalConfidenceResult,
} from "../lib/proposal-confidence";
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

  /**
   * Slice 20k — shadow calibration summary. Derived from the same raw
   * `ClosedDealAuditRow[]` as the worst-misses card, but answers a
   * different question: "how often does the shadow score agree with
   * reality, and when it disagrees with the rule scorer, who's right?"
   * This closes the Move-2 loop — the shadow from 20j lives on the
   * live strip; this card proves whether it deserves that real estate.
   * Hidden cleanly for forbidden (rep) and zero-rows empty states.
   */
  const shadowCalibrationSummary = useMemo<ShadowAgreementSummary | null>(() => {
    const r = closedAuditQuery.data;
    if (!r || !r.ok) return null;
    if (r.audits.length === 0) return null;
    const retros = computeRetrospectiveShadows(r.audits);
    return computeShadowAgreementSummary(retros);
  }, [closedAuditQuery.data]);

  /**
   * Slice 20m — scorer-evolution proposal. Top-level factor-attribution
   * query feeds the `ScorerProposalCard` below. We intentionally declare
   * this at page level (not inside FactorAttributionPanel) even though
   * the query key matches, because TanStack Query dedupes identical keys
   * into a single fetch and shared cache — so when a manager expands the
   * factor breakdown *and* we render the proposal card, only one request
   * goes out. Same gating as the other instrumentation queries: enabled
   * once calibration has proven the role has access, to avoid spraying
   * 403s at reps.
   */
  const factorsQueryTop = useQuery({
    queryKey: ["quote-builder", "factor-attribution"],
    queryFn: getFactorAttributionDeals,
    staleTime: 5 * 60 * 1000,
    enabled: closedAuditEnabled,
  });

  /**
   * Proposal renders iff:
   *   • factors query loaded and ok (managers+ only via role gate)
   *   • report has ≥ 1 factor — otherwise the headline is the only
   *     content and a full card is dead weight
   * We feed `shadowCalibrationSummary` as the second arg so the
   * corroboration line reflects the Move-2 shadow's track record; a
   * null summary (rep / thin data / no closed deals) gracefully yields
   * null corroboration.
   */
  const scorerProposal = useMemo<ScorerProposal | null>(() => {
    const r = factorsQueryTop.data;
    if (!r || !r.ok) return null;
    const report = computeFactorAttribution(r.deals);
    if (report.factors.length === 0) return null;
    return computeScorerProposal(report, shadowCalibrationSummary);
  }, [factorsQueryTop.data, shadowCalibrationSummary]);

  /**
   * Slice 20p — scorer what-if preview. Runs the proposed changes against
   * the raw closed-deal audit rows (same data the worst-misses card uses)
   * and returns current vs. simulated Brier + hit-rate so the manager can
   * see whether applying the proposal would make the scorer more or less
   * accurate before they open a ticket. Reuses `closedAuditQuery` — no
   * extra fetch. Null when we don't have a proposal or no audits yet.
   */
  const scorerWhatIf = useMemo<ScorerWhatIfResult | null>(() => {
    if (!scorerProposal) return null;
    const r = closedAuditQuery.data;
    if (!r || !r.ok) return null;
    const result = simulateProposalCalibration(scorerProposal, r.audits);
    if (result.dealsSimulated === 0) return null;
    return result;
  }, [scorerProposal, closedAuditQuery.data]);

  /**
   * Slice 20r — factor drift. Splits the same closed-deal audit rows
   * into recent vs. prior windows and surfaces factors whose predictive
   * power has moved meaningfully. This is the feedback loop that keeps
   * the rule scorer honest over time: aggregate attribution can look
   * fine while the scorer has silently degraded quarter-over-quarter.
   * Drift makes that degradation visible.
   *
   * Hidden when there are no drifting factors (the quiet-good case) or
   * when we have no audits at all (rep view / empty state). Null-result
   * gating keeps the instrumentation stack crisp — cards only surface
   * when they carry a finding.
   */
  const factorDriftReport = useMemo<FactorDriftReport | null>(() => {
    const r = closedAuditQuery.data;
    if (!r || !r.ok) return null;
    if (r.audits.length === 0) return null;
    const report = computeFactorDrift(r.audits);
    if (report.drifts.length === 0) return null;
    return report;
  }, [closedAuditQuery.data]);

  /**
   * Slice 20s — calibration drift. Same reference data as 20r (closed-
   * deal audit rows) but aggregates to the scorer-wide level: is the
   * engine getting sharper or dulling, and by how much? Pairs with 20r
   * above — drift tells the manager *which rules* moved; this card
   * tells them *whether the whole scorer* moved.
   *
   * Hidden when we have no closed deals at all. Stable-with-data still
   * renders — "calibration is holding steady" is itself a useful fact
   * for a quarterly review, not noise to hide.
   */
  const calibrationDrift = useMemo<CalibrationDriftReport | null>(() => {
    const r = closedAuditQuery.data;
    if (!r || !r.ok) return null;
    if (r.audits.length === 0) return null;
    return computeCalibrationDrift(r.audits);
  }, [closedAuditQuery.data]);

  /**
   * Slice 20t — proposal urgency. Decides how loudly the scorer-
   * evolution card speaks based on 20s's calibration trend. High when
   * the scorer is dulling substantively on trusted data; low when it's
   * sharpening on its own; medium otherwise. The proposal card props
   * through `urgency` to pick its border tone + pill copy, so a
   * degrading calibration escalates the manager's attention without
   * the rep-facing surfaces changing at all.
   */
  const proposalUrgency = useMemo<ProposalUrgencyResult>(
    () => computeProposalUrgency(calibrationDrift),
    [calibrationDrift],
  );

  /**
   * Slice 20v — proposal meta-confidence. Composes every signal we've
   * already computed (sample size from closed audits, calibration drift
   * direction, what-if Brier/hit-rate delta, shadow disagreement track
   * record, factor-drift coherence) into a single 0..100 score with
   * per-driver rationale. Answers the manager's "should I actually
   * apply this?" question without asking them to triangulate across
   * five cards. Null when there's no proposal.
   */
  const proposalConfidence = useMemo<ProposalConfidenceResult | null>(() => {
    if (!scorerProposal) return null;
    const auditCount = closedAuditQuery.data?.ok
      ? closedAuditQuery.data.audits.length
      : 0;
    return computeProposalConfidence(scorerProposal, {
      calibrationDrift,
      factorDrift: factorDriftReport,
      whatIf: scorerWhatIf,
      shadowAgreement: shadowCalibrationSummary,
      auditCount,
    });
  }, [
    scorerProposal,
    calibrationDrift,
    factorDriftReport,
    scorerWhatIf,
    shadowCalibrationSummary,
    closedAuditQuery.data,
  ]);

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

      {/* Slice 20s: calibration drift. Immediately below the calibration
          card because the two are a natural pair — one reads "the scorer
          is 67% accurate", the next reads "and that's +8pp vs last
          quarter." Direction-colored accent pills ride on a neutral
          indigo-violet card so the palette doesn't over-claim either
          direction while the underlying calibration card keeps its
          emerald. Hidden when we have no closed deals at all. */}
      {calibrationDrift && <CalibrationDriftCard report={calibrationDrift} />}

      {/* Slice 20k: shadow calibration — "does the shadow score deserve
          to sit next to the live score?" Renders between calibration
          and closed-deals cards so the instrumentation story flows:
          (1) rule scorer accuracy → (2) shadow scorer accuracy →
          (3) worst individual misses. Hidden silently when we lack
          scorable data; `describeShadowTrustHeadline` owns the
          low-confidence / no-data / coin-flip copy. */}
      {shadowCalibrationSummary && shadowCalibrationSummary.totalDeals > 0 && (
        <ShadowCalibrationCard summary={shadowCalibrationSummary} />
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

      {/* Slice 20r: factor drift. Sits between worst-misses and the
          evolution proposal so the narrative flows: (1) which deals the
          scorer missed → (2) which rules are drifting under the hood →
          (3) the concrete evolution the manager should consider. Amber
          palette reads as "watch this" without escalating to the rose
          alarm used for worst misses. Hidden when no factors drift. */}
      {factorDriftReport && <FactorDriftCard report={factorDriftReport} />}

      {/* Slice 20m: scorer-evolution proposal. Sits at the bottom of the
          instrumentation stack because it synthesizes every card above:
          calibration tells us the scorer's aggregate accuracy, the
          factor panel tells us which rules earn their weight, the
          worst-misses card surfaces the individual failures, and the
          shadow calibration tells us whether the K-NN alternative is
          worth listening to. The proposal is the human-actionable
          handoff — "here's how to evolve the scorer based on all of
          the above." Hidden for reps + thin data. */}
      {scorerProposal && proposalConfidence && (
        <ScorerProposalCard
          proposal={scorerProposal}
          whatIf={scorerWhatIf}
          urgency={proposalUrgency}
          confidence={proposalConfidence}
          calibrationDrift={calibrationDrift}
          factorDrift={factorDriftReport}
        />
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
 * Slice 20k — shadow calibration card.
 *
 * Closes the Move-2 loop: 20j surfaces the shadow score on every live
 * deal; this card proves whether managers should trust it. Renders
 * aggregate agreement rates for the rule scorer and the shadow, plus
 * — the Move-2 critical stat — who wins when they disagree.
 *
 * We deliberately resist "beating the drum" for the shadow:
 *   • Rate bars are neutral sky, not emerald victories.
 *   • Headline copy cites the literal win-rate; it changes tone (not
 *     substance) at 60%/40% to flag directional reads honestly.
 *   • Low-confidence (thin data) collapses to a single line.
 *
 * The card's job is transparency, not advocacy.
 */
function ShadowCalibrationCard({ summary }: { summary: ShadowAgreementSummary }) {
  const headline = describeShadowTrustHeadline(summary);
  const ruleRate = summary.ruleAgreementRate;
  const shadowRate = summary.shadowAgreementRate;
  const showRates = !summary.lowConfidence && summary.scorableDeals > 0;

  return (
    <Card
      className="border-sky-500/30 bg-sky-500/5 p-3"
      role="region"
      aria-label="Shadow calibration"
    >
      <div className="flex items-start gap-2">
        <Gauge className="h-4 w-4 shrink-0 text-sky-400" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-400">
              Shadow calibration
            </span>
            <span
              className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap"
              aria-label={
                `${summary.scorableDeals} deals scored by both, ${summary.shadowAbstainCount} abstained by shadow due to thin data`
              }
            >
              {summary.scorableDeals}/{summary.totalDeals} scored
              {summary.shadowAbstainCount > 0 && ` · ${summary.shadowAbstainCount} thin`}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-foreground">{headline}</p>

          {showRates && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <AgreementRatePill label="Rule scorer" rate={ruleRate} count={summary.ruleAgreedCount} total={summary.scorableDeals} />
              <AgreementRatePill label="Shadow" rate={shadowRate} count={summary.shadowAgreedCount} total={summary.scorableDeals} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Compact agreement rate pill. Neutral sky styling for both halves —
 * this is a reporting surface, not a contest. `rate` in [0, 1] or null;
 * null renders as a muted "—" so a malformed / thin slice doesn't
 * imply "0% agreement".
 */
function AgreementRatePill({
  label,
  rate,
  count,
  total,
}: {
  label: string;
  rate: number | null;
  count: number;
  total: number;
}) {
  const pct = rate === null ? null : Math.round(rate * 100);
  const ariaLabel =
    pct === null
      ? `${label}: agreement rate unavailable`
      : `${label}: agreed on ${count} of ${total} deals, ${pct} percent`;
  return (
    <div
      className="rounded-md border border-sky-500/20 bg-background/40 px-2 py-1.5"
      role="group"
      aria-label={ariaLabel}
    >
      <div className="flex items-baseline justify-between gap-2" aria-hidden="true">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-sky-300">
          {pct === null ? "—" : `${pct}%`}
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted/30" aria-hidden="true">
        <div
          className="h-full rounded-full bg-sky-500"
          style={{ width: pct === null ? "0%" : `${pct}%` }}
        />
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums" aria-hidden="true">
        {count} / {total}
      </div>
    </div>
  );
}

/**
 * Slice 20s — calibration drift card.
 *
 * Manager/owner-only. Complements the scorer-calibration card directly
 * above it: that card shows current hit-rate + Brier; this card shows
 * whether either has moved between a recent and a prior window. The
 * copy comes from the lib so tests pin the wording.
 *
 * Direction drives tone:
 *   • improving → emerald accent pill
 *   • degrading → rose accent pill
 *   • stable    → muted accent pill
 * The card itself uses a neutral indigo-violet palette so a "holding
 * steady" reading doesn't look like a win or a loss.
 */
function CalibrationDriftCard({ report }: { report: CalibrationDriftReport }) {
  const headline = describeCalibrationDriftHeadline(report);
  const tone =
    report.lowConfidence
      ? { border: "border-muted/40", text: "text-muted-foreground", bg: "bg-muted/30" }
      : report.direction === "improving"
        ? { border: "border-emerald-500/30", text: "text-emerald-300", bg: "bg-emerald-500/15" }
        : report.direction === "degrading"
          ? { border: "border-rose-500/30", text: "text-rose-300", bg: "bg-rose-500/15" }
          : { border: "border-muted/40", text: "text-muted-foreground", bg: "bg-muted/30" };
  const directionLabel =
    report.direction === "improving"
      ? "SHARPENING"
      : report.direction === "degrading"
        ? "DULLING"
        : "STABLE";
  return (
    <Card
      className="border-indigo-500/30 bg-indigo-500/5 p-3"
      role="region"
      aria-label="Calibration drift"
    >
      <div className="flex items-start gap-2">
        <Gauge className="h-4 w-4 shrink-0 text-indigo-400" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-400">
              Calibration drift ({report.windowDays}d)
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${tone.text} ${tone.bg}`}
            >
              {directionLabel}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-foreground">{headline}</p>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <CalibrationDriftMetric
              label="Hit rate"
              recent={report.recentAccuracy}
              prior={report.priorAccuracy}
              delta={report.accuracyDelta}
              deltaFormatter={formatSignedPct}
              valueFormatter={(v) => (v === null ? "—" : `${Math.round(v * 100)}%`)}
              higherIsBetter
            />
            <CalibrationDriftMetric
              label="Brier"
              recent={report.recentBrier}
              prior={report.priorBrier}
              delta={report.brierDelta}
              deltaFormatter={formatBrierDelta}
              valueFormatter={(v) => (v === null ? "—" : v.toFixed(3))}
              higherIsBetter={false}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground tabular-nums">
            {report.recentN} recent · {report.priorN} prior deals
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * One side-by-side metric cell for the calibration-drift card. "higher
 * is better" flips the good/bad interpretation of positive delta: for
 * hit-rate, +5pp is good → emerald; for Brier, +0.02 is bad → rose.
 */
function CalibrationDriftMetric({
  label,
  recent,
  prior,
  delta,
  deltaFormatter,
  valueFormatter,
  higherIsBetter,
}: {
  label: string;
  recent: number | null;
  prior: number | null;
  delta: number | null;
  deltaFormatter: (v: number | null) => string;
  valueFormatter: (v: number | null) => string;
  higherIsBetter: boolean;
}) {
  const deltaTone =
    delta === null || delta === 0
      ? "text-muted-foreground"
      : higherIsBetter
        ? delta > 0
          ? "text-emerald-300"
          : "text-rose-300"
        : delta > 0
          ? "text-rose-300"
          : "text-emerald-300";
  const ariaLabel =
    delta === null
      ? `${label}: delta unavailable`
      : `${label}: recent ${valueFormatter(recent)}, prior ${valueFormatter(prior)}, change ${deltaFormatter(delta)}`;
  return (
    <div
      className="rounded-md border border-indigo-500/20 bg-background/40 px-2 py-1.5"
      role="group"
      aria-label={ariaLabel}
    >
      <div className="flex items-baseline justify-between gap-2" aria-hidden="true">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={`text-xs font-semibold tabular-nums ${deltaTone}`}>
          {deltaFormatter(delta)}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1 text-[10px] text-muted-foreground tabular-nums" aria-hidden="true">
        <span>{valueFormatter(prior)}</span>
        <span>→</span>
        <span className="font-semibold text-foreground">{valueFormatter(recent)}</span>
      </div>
    </div>
  );
}

/**
 * Slice 20r — factor drift card.
 *
 * Manager/owner-only quarterly-watch card. Aggregate attribution tells
 * you which factors earn their weight *across all time*; this card
 * tells you which factors have *moved* — a tailwind shrinking, a
 * headwind emerging, or (worst) a sign-flip where the rule now predicts
 * the opposite of what it used to.
 *
 * Amber palette for the card header reads as "watch this" without
 * escalating to the rose alarm of the worst-misses card. Per-row
 * coloring runs hotter: rose for flipped, amber for falling, emerald
 * for rising (good news — undercounted tailwind), muted when the row
 * is low-confidence.
 *
 * The component is presentation-only; copy comes from
 * `describeDriftHeadline` and `describeDriftRationale` so tests pin
 * the wording.
 */
function FactorDriftCard({ report }: { report: FactorDriftReport }) {
  const headline = describeDriftHeadline(report);
  // Cap at 5 rows so the card stays scannable. Drifts are already
  // sorted by |drift| desc in the lib — the worst-moved factor is on
  // top.
  const top = report.drifts.slice(0, 5);
  const hiddenCount = Math.max(0, report.drifts.length - top.length);
  return (
    <Card
      className="border-amber-500/30 bg-amber-500/5 p-3"
      role="region"
      aria-label="Factor drift"
    >
      <div className="flex items-start gap-2">
        <TrendingDown className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
              Factor drift ({report.windowDays}d)
            </span>
            <span
              className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap"
              aria-label={`${report.recentN} recent and ${report.priorN} prior closed deals`}
            >
              {report.recentN} recent · {report.priorN} prior
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-foreground">{headline}</p>

          <ul className="mt-2 space-y-1.5" role="list">
            {top.map((d) => (
              <FactorDriftRow key={d.label} drift={d} />
            ))}
          </ul>
          {hiddenCount > 0 && (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              +{hiddenCount} more drifting factor{hiddenCount === 1 ? "" : "s"} not shown.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * One drifting-factor row. Direction drives color; rationale copy
 * lives in the lib so tests pin it and this stays presentation-only.
 */
function FactorDriftRow({ drift }: { drift: FactorDrift }) {
  const rationale = describeDriftRationale(drift);
  const tone =
    drift.lowConfidence
      ? { border: "border-muted/40", bg: "bg-background/40", pill: "text-muted-foreground", pillBg: "bg-muted/40" }
      : drift.direction === "flipped"
        ? { border: "border-rose-500/30", bg: "bg-rose-500/5", pill: "text-rose-300", pillBg: "bg-rose-500/15" }
        : drift.direction === "falling"
          ? { border: "border-amber-500/30", bg: "bg-amber-500/5", pill: "text-amber-300", pillBg: "bg-amber-500/15" }
          : { border: "border-emerald-500/30", bg: "bg-emerald-500/5", pill: "text-emerald-300", pillBg: "bg-emerald-500/15" };
  const driftPct = drift.drift === null ? null : Math.round(drift.drift * 100);
  const driftLabel =
    driftPct === null ? "—" : `${driftPct > 0 ? "+" : ""}${driftPct}pp`;
  const directionLabel =
    drift.direction === "flipped"
      ? "FLIPPED"
      : drift.direction === "falling"
        ? "FALLING"
        : drift.direction === "rising"
          ? "RISING"
          : "STABLE";
  return (
    <li
      className={`rounded-md border ${tone.border} ${tone.bg} px-2 py-1.5`}
      role="group"
      aria-label={rationale}
    >
      <div className="flex items-center justify-between gap-2" aria-hidden="true">
        <span className="truncate text-[11px] font-medium text-foreground">{drift.label}</span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${tone.pill} ${tone.pillBg}`}
        >
          {directionLabel} {driftLabel}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground" aria-hidden="true">
        {rationale}
      </p>
    </li>
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

/**
 * Slice 20m — scorer-evolution proposal card.
 *
 * Translates the raw attribution + calibration numbers into a
 * human-actionable "here's how to change the scorer" recommendation.
 * Collapsed by default: the headline alone is enough daily context;
 * the expanded state shows per-factor actions and an optional shadow
 * corroboration note, plus a one-click copy to lift the whole thing
 * into a ticket for the scorer-evolution PR.
 *
 * Design rules:
 *   • Violet accent — distinct from calibration (sky), misses (rose),
 *     and the general app palette, so managers recognize this card's
 *     role as "recommendation" rather than "report".
 *   • Action badges borrow the scorer-verdict color grammar:
 *     flip / strengthen = emerald-adjacent, drop / weaken = rose-adjacent,
 *     keep = muted. Never stronger than the underlying data — the
 *     same "transparency, not advocacy" rule as the shadow card.
 *   • Low-confidence shows a visible amber caveat; the tone mirrors
 *     calibration's own low-confidence warning so the pattern reads
 *     identically across cards.
 *   • The copy button lifts the rendered markdown to the clipboard
 *     via `navigator.clipboard.writeText`. We swallow failures (older
 *     browsers, permission denied) and flash a fallback toast-less
 *     inline confirmation. Copy, not select-text-manually, because
 *     the whole point of this card is a frictionless handoff.
 */
function ScorerProposalCard({
  proposal,
  whatIf,
  urgency,
  confidence,
  calibrationDrift,
  factorDrift,
}: {
  proposal: ScorerProposal;
  /** Slice 20p — simulated Brier + hit-rate under the proposal. Null
   *  when we don't have closed-deal audits to simulate against, or when
   *  the proposal has no actionable changes. */
  whatIf: ScorerWhatIfResult | null;
  /** Slice 20t — urgency + rationale derived from 20s's calibration
   *  drift. Tunes card tone and adds a priority pill + contextual
   *  sentence so a dulling scorer escalates and an improving one
   *  softens. `medium` with `rationale=null` is the silent default. */
  urgency: ProposalUrgencyResult;
  /** Slice 20v — proposal meta-confidence. Composes sample size,
   *  calibration drift, what-if delta, shadow corroboration, and
   *  factor-drift coherence into one 0..100 number with per-driver
   *  rationale. Rendered as a second pill next to urgency and as a
   *  drivers list in the expanded panel so the manager can see
   *  exactly how the confidence was earned. */
  confidence: ProposalConfidenceResult;
  /** Slice 20u — scorer-wide calibration drift (20s) passed through so
   *  the "Copy as ticket" handoff carries the full evidence chain, not
   *  just the proposal body. Null when no calibration window exists. */
  calibrationDrift: CalibrationDriftReport | null;
  /** Slice 20u — per-factor drift (20r) passed through for the same
   *  clipboard-evidence reason. Null / empty drifts fall out of the
   *  rendered markdown cleanly. */
  factorDrift: FactorDriftReport | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    },
    [],
  );

  const actionable = proposal.changes.filter((c) => c.action !== "keep");
  const keeps = proposal.changes.filter((c) => c.action === "keep");

  async function handleCopy() {
    try {
      // Slice 20u — the clipboard now carries the full evidence chain:
      // urgency, calibration drift, factor drift, and what-if alongside
      // the proposal body. The context renderer falls through to the
      // bare 20m output when every section is silent, so nothing bloats
      // the ticket without earning it.
      const markdown = renderProposalMarkdownWithContext(proposal, {
        calibrationDrift,
        factorDrift,
        urgency,
        whatIf,
      });
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fall back silently — structured rows are still visible and
      // selectable in the expanded panel below, so a manager can
      // copy+paste a less-formatted version manually. Surfacing an
      // error toast here would be worse UX than silent degradation.
    }
  }

  // Urgency drives the card's border tone + header-area pill so a
  // dulling scorer escalates and an improving one softens. Headline
  // accent color (violet) is preserved so the card identity holds even
  // when escalated — only the border + pill change.
  const urgencyTone =
    urgency.urgency === "high"
      ? { border: "border-rose-500/40", cardBg: "bg-rose-500/5", pillBg: "bg-rose-500/15", pillText: "text-rose-300" }
      : urgency.urgency === "low"
        ? { border: "border-emerald-500/30", cardBg: "bg-emerald-500/5", pillBg: "bg-emerald-500/15", pillText: "text-emerald-300" }
        : { border: "border-violet-500/30", cardBg: "bg-violet-500/5", pillBg: "bg-violet-500/15", pillText: "text-violet-300" };

  return (
    <Card
      className={`${urgencyTone.border} ${urgencyTone.cardBg} p-3`}
      role="region"
      aria-label={`Scorer evolution proposal (${urgency.urgency} urgency)`}
    >
      <div className="flex items-start gap-2">
        <Wand2 className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-400">
              Scorer evolution proposal
            </span>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${urgencyTone.pillBg} ${urgencyTone.pillText}`}
                aria-label={`Urgency: ${urgency.urgency}`}
              >
                {describeProposalUrgencyPill(urgency.urgency)}
              </span>
              {/* Slice 20v — meta-confidence pill. Separate from urgency
                  because the two answer different questions: urgency is
                  "how fast should I act?", confidence is "how much
                  should I trust the call?". Color maps by band so
                  managers can read confidence independent of how
                  urgently the card is shouting. */}
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${
                  confidence.band === "high"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : confidence.band === "low"
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-sky-500/15 text-sky-300"
                }`}
                aria-label={`Confidence: ${confidence.confidence} out of 100 — ${confidence.band} band`}
                title={confidence.rationale}
              >
                {confidence.confidence} · {describeProposalConfidencePill(confidence.band)}
              </span>
              <span
                className="text-[10px] text-muted-foreground tabular-nums"
                aria-label={`${actionable.length} recommended changes, ${keeps.length} keep as-is`}
              >
                {actionable.length} change{actionable.length === 1 ? "" : "s"}
                {keeps.length > 0 && ` · ${keeps.length} keep`}
              </span>
            </div>
          </div>
          <p className="mt-0.5 text-[11px] text-foreground">{proposal.headline}</p>
          {urgency.rationale && (
            <p
              className={`mt-1 text-[10px] ${urgency.urgency === "high" ? "text-rose-300" : urgency.urgency === "low" ? "text-emerald-300" : "text-muted-foreground"}`}
            >
              {urgency.rationale}
            </p>
          )}
          {proposal.lowConfidence && (
            <p
              className="mt-1 text-[10px] text-amber-400"
              title="Based on a small closed-deal sample — re-run once more deals accumulate."
            >
              ⚠ Thin sample — treat these recommendations as directional.
            </p>
          )}

          {/* Slice 20p — what-if preview. Renders only when we have
              audits AND the proposal has at least one actionable change.
              Hidden deliberately on all-keep / no-audits so the card
              doesn't read "0.00 → 0.00" and waste the manager's attention. */}
          {whatIf && !whatIf.noActionableChanges && whatIf.currentBrier !== null && (
            <ScorerWhatIfRow whatIf={whatIf} />
          )}

          <div className="mt-2 flex items-center gap-2 border-t border-violet-500/20 pt-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-violet-400 hover:text-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              aria-expanded={expanded}
              aria-controls="scorer-proposal-body"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" aria-hidden />
              ) : (
                <ChevronRight className="h-3 w-3" aria-hidden />
              )}
              {expanded ? "Hide proposal" : "Review proposal"}
            </button>
            {expanded && actionable.length + keeps.length > 0 && (
              <button
                type="button"
                onClick={handleCopy}
                className="ml-auto inline-flex items-center gap-1 rounded border border-violet-500/30 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-violet-300 hover:bg-violet-500/10 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                aria-label="Copy proposal as ticket markdown"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" aria-hidden /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden /> Copy as ticket
                  </>
                )}
              </button>
            )}
          </div>

          {expanded && (
            <div id="scorer-proposal-body" className="mt-2 space-y-2">
              {/* Slice 20v — confidence rationale + per-driver breakdown.
                  Rendered first in the expanded body because the manager's
                  next decision is "do I trust this?" before "what would
                  I change?" — answer that up front, then show the changes. */}
              <div className="rounded border border-sky-500/20 bg-sky-500/5 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">
                    Confidence breakdown
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {confidence.confidence}/100
                  </div>
                </div>
                <p className="mt-0.5 text-[11px] text-foreground">
                  {confidence.rationale}
                </p>
                {confidence.drivers.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {confidence.drivers.map((d) => (
                      <li
                        key={d.signal}
                        className="flex items-start gap-2 text-[10px] text-muted-foreground"
                      >
                        <span
                          className={`shrink-0 tabular-nums font-semibold ${
                            d.contribution > 0
                              ? "text-emerald-400"
                              : d.contribution < 0
                                ? "text-rose-400"
                                : "text-muted-foreground"
                          }`}
                          aria-label={`contribution ${d.contribution}`}
                        >
                          {d.contribution > 0 ? "+" : ""}
                          {d.contribution}
                        </span>
                        <span className="flex-1">{d.rationale}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {actionable.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
                    Recommended changes
                  </div>
                  <ul className="mt-1 space-y-1">
                    {actionable.map((c) => (
                      <ScorerProposalChangeRow key={c.label} change={c} />
                    ))}
                  </ul>
                </div>
              )}
              {keeps.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Keep as-is
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {keeps.map((c) => (
                      <li
                        key={c.label}
                        className="flex items-center gap-2 text-[10px] text-muted-foreground"
                      >
                        <span className="truncate text-foreground" title={c.label}>
                          {c.label}
                        </span>
                        <span className="flex-1 truncate" title={c.rationale}>
                          — {c.rationale}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal.shadowCorroboration && (
                <p className="border-t border-violet-500/20 pt-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-sky-400">Shadow K-NN:</span>{" "}
                  {proposal.shadowCorroboration}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Slice 20p — what-if preview row inside the ScorerProposalCard.
 *
 * Two compact metric pills (Brier + hit-rate) plus a one-line headline
 * from `describeWhatIfHeadline`. Color grammar:
 *
 *   • Emerald: proposal improves accuracy (Brier ↓ or hit-rate ↑)
 *   • Rose:    proposal regresses (Brier ↑ or hit-rate ↓)
 *   • Muted:   unchanged (delta exactly 0)
 *
 * We surface the `N deals` count in the row's aria-label rather than the
 * visible pill — the pill is already dense and a screenreader user still
 * needs the sample size to weigh the number. Low-confidence is carried
 * by `describeWhatIfHeadline` (it appends "— directional only (N deals)")
 * so we don't need a second caveat stripe here; the headline already
 * conveys the tone, and duplicating it would double the visual weight.
 */
function ScorerWhatIfRow({ whatIf }: { whatIf: ScorerWhatIfResult }) {
  const headline = describeWhatIfHeadline(whatIf);
  if (
    !headline ||
    whatIf.currentBrier === null ||
    whatIf.simulatedBrier === null ||
    whatIf.brierDelta === null ||
    whatIf.currentHitRate === null ||
    whatIf.simulatedHitRate === null ||
    whatIf.hitRateDelta === null
  ) {
    return null;
  }

  // Brier lower = better. Negative delta = improvement.
  const brierImproves = whatIf.brierDelta < 0;
  const brierSame = whatIf.brierDelta === 0;
  const brierTone = brierSame
    ? "text-muted-foreground"
    : brierImproves
      ? "text-emerald-300"
      : "text-rose-300";
  const brierArrow = brierSame ? "·" : brierImproves ? "↓" : "↑";
  const brierAbs = Math.abs(whatIf.brierDelta).toFixed(3);

  // Hit-rate higher = better. We use the ROUNDED-visible values (not the
  // raw delta) to compute the pp arrow so the pill is internally
  // consistent: "60% → 68% ↑8pp", not "60% → 68% ↑7pp" when the raw diff
  // happened to round down while the endpoints rounded up.
  const hitCurrentPct = Math.round(whatIf.currentHitRate * 100);
  const hitSimulatedPct = Math.round(whatIf.simulatedHitRate * 100);
  const hitVisibleDelta = hitSimulatedPct - hitCurrentPct;
  const hitImproves = hitVisibleDelta > 0;
  const hitSame = hitVisibleDelta === 0;
  const hitTone = hitSame
    ? "text-muted-foreground"
    : hitImproves
      ? "text-emerald-300"
      : "text-rose-300";
  const hitArrow = hitSame ? "·" : hitImproves ? "↑" : "↓";
  const hitAbsPp = Math.abs(hitVisibleDelta);

  const ariaLabel = `What-if preview over ${whatIf.dealsSimulated} closed deals. Brier ${whatIf.currentBrier.toFixed(3)} to ${whatIf.simulatedBrier.toFixed(3)}. Hit rate ${hitCurrentPct} percent to ${hitSimulatedPct} percent.`;

  return (
    <div
      className="mt-2 rounded-md border border-violet-500/20 bg-background/40 px-2 py-1.5"
      role="group"
      aria-label={ariaLabel}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-400">
        <Gauge className="h-3 w-3" aria-hidden />
        If applied
      </div>
      <p
        className="mt-0.5 text-[11px] text-foreground"
        title="Lower Brier = more accurate probabilities; higher hit rate = better band calls."
      >
        {headline}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded border border-violet-500/20 bg-background/40 px-1.5 py-0.5 text-[10px]"
          title="Brier = mean squared error on probability. Lower is better; 0.25 is a coin-flip baseline."
          aria-hidden
        >
          <span className="text-muted-foreground">Brier</span>
          <span className="tabular-nums text-foreground">
            {whatIf.currentBrier.toFixed(3)}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="tabular-nums text-foreground">
            {whatIf.simulatedBrier.toFixed(3)}
          </span>
          <span className={`tabular-nums font-semibold ${brierTone}`}>
            {brierArrow}
            {brierSame ? "" : brierAbs}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1 rounded border border-violet-500/20 bg-background/40 px-1.5 py-0.5 text-[10px]"
          title="Hit rate = share of closed deals where the score's band matched reality (win vs. loss)."
          aria-hidden
        >
          <span className="text-muted-foreground">Hit</span>
          <span className="tabular-nums text-foreground">{hitCurrentPct}%</span>
          <span className="text-muted-foreground">→</span>
          <span className="tabular-nums text-foreground">{hitSimulatedPct}%</span>
          <span className={`tabular-nums font-semibold ${hitTone}`}>
            {hitArrow}
            {hitSame ? "" : `${hitAbsPp}pp`}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Per-factor row for the scorer proposal's actionable section. Action
 * badge + label + rationale. Color grammar is deliberately muted (see
 * parent card's docstring) — we want the manager to read the rationale,
 * not feel pressured by a neon recommendation.
 */
function ScorerProposalChangeRow({ change }: { change: ScorerFactorChange }) {
  const palette: Record<
    ScorerFactorChange["action"],
    { bg: string; text: string; border: string }
  > = {
    flip:       { bg: "bg-rose-500/10",    text: "text-rose-300",    border: "border-rose-500/30" },
    strengthen: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/30" },
    weaken:     { bg: "bg-amber-500/10",   text: "text-amber-300",   border: "border-amber-500/30" },
    drop:       { bg: "bg-muted/30",       text: "text-muted-foreground", border: "border-border" },
    keep:       { bg: "bg-muted/20",       text: "text-muted-foreground", border: "border-border" },
  };
  const p = palette[change.action];
  const ariaSummary = `${change.action} ${change.label}: ${change.rationale}`;
  return (
    <li>
      <span role="group" aria-label={ariaSummary} className="flex items-start gap-2 text-[11px]">
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${p.bg} ${p.text} ${p.border}`}
          aria-hidden
        >
          {change.action}
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-mono text-foreground" title={change.label}>
            {change.label}
          </span>
          <span className="text-muted-foreground"> — {change.rationale}</span>
        </span>
      </span>
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
