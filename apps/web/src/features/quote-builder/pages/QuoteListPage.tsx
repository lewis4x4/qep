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
import {
  computeProposalCallFlips,
  describeCallFlipsHeadline,
  formatFlipRow,
  type ProposalCallFlipReport,
  type CallFlip,
} from "../lib/proposal-call-flips";
import {
  computeProposalApplyVerdict,
  describeProposalVerdictPill,
  type ProposalApplyVerdict,
} from "../lib/proposal-apply-verdict";
import {
  computeProposalWatchlist,
  type ProposalWatchlist,
} from "../lib/proposal-watchlist";
import {
  computeProposalStability,
  describeStabilityPill,
  type ProposalStabilityReport,
} from "../lib/proposal-stability";
import {
  computeProposalRollback,
  type ProposalRollbackPlan,
} from "../lib/proposal-rollback";
import {
  computeProposalPreflightChecklist,
  describeReadinessPill,
  type PreflightChecklist,
} from "../lib/proposal-preflight-checklist";
import {
  computeProposalDiff,
  describeProposalDiffPill,
  type ProposalDiff,
} from "../lib/proposal-diff";
import {
  computeProposalConsolidation,
  describeConsolidationPill,
  type ProposalConsolidationReport,
} from "../lib/proposal-consolidation";
import {
  computeProposalStreakBreaks,
  describeStreakBreaksPill,
  type ProposalStreakBreakReport,
} from "../lib/proposal-streak-breaks";
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
  /**
   * The factor-attribution report is computed once here and reused by
   * both the proposal itself (20m) and the stability / sensitivity
   * analysis (20aa). Keeping it memoised at page scope means we don't
   * recompute the same deal-grouped aggregation when either downstream
   * memo fires.
   */
  const attributionReport = useMemo<FactorAttributionReport | null>(() => {
    const r = factorsQueryTop.data;
    if (!r || !r.ok) return null;
    return computeFactorAttribution(r.deals);
  }, [factorsQueryTop.data]);

  const scorerProposal = useMemo<ScorerProposal | null>(() => {
    if (!attributionReport || attributionReport.factors.length === 0) return null;
    return computeScorerProposal(attributionReport, shadowCalibrationSummary);
  }, [attributionReport, shadowCalibrationSummary]);

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

  /**
   * Slice 20w — per-deal call flips. Converts 20p's aggregate what-if
   * into a concrete "which specific closed deals would the proposal
   * have called differently, and did the flip agree with reality?"
   * Bucketizes into corroborating / regressing / unchanged so a
   * manager can eyeball the specific deals the proposal touches —
   * especially important when there's even a single regressing flip.
   * Null when we don't have a what-if (no audits yet) or when the
   * proposal is all-keep (nothing to simulate a flip from).
   */
  const proposalCallFlips = useMemo<ProposalCallFlipReport | null>(() => {
    if (!scorerWhatIf) return null;
    const report = computeProposalCallFlips(scorerWhatIf);
    if (report.empty || report.noActionableChanges) return null;
    return report;
  }, [scorerWhatIf]);

  /**
   * Slice 20y — the composed apply/review/hold/defer verdict. Rides on
   * top of every upstream evidence module (confidence, flips, what-if,
   * urgency) to deliver a single busy-manager decision. Computed even
   * when signals are partial so the caller can still render a 'review
   * — can't verify' state rather than a silent nothing. Null only when
   * there's literally no proposal.
   */
  const proposalVerdict = useMemo<ProposalApplyVerdict | null>(() => {
    if (!scorerProposal) return null;
    return computeProposalApplyVerdict({
      proposal: scorerProposal,
      confidence: proposalConfidence,
      callFlips: proposalCallFlips,
      whatIf: scorerWhatIf,
      urgency: proposalUrgency,
    });
  }, [
    scorerProposal,
    proposalConfidence,
    proposalCallFlips,
    scorerWhatIf,
    proposalUrgency,
  ]);

  /**
   * Slice 20z — post-apply watchlist. For each actionable factor,
   * emits a concern + reconsideration trigger + priority ranking so
   * the manager has a concrete monitoring plan the moment they apply.
   * Ranked high→medium→low inside the module. Empty / null when no
   * factors warrant monitoring — the UI and markdown both drop the
   * section cleanly rather than showing "0 watched."
   */
  const proposalWatchlist = useMemo<ProposalWatchlist | null>(() => {
    if (!scorerProposal) return null;
    return computeProposalWatchlist(scorerProposal, factorDriftReport);
  }, [scorerProposal, factorDriftReport]);

  /**
   * Slice 20aa — proposal stability / sensitivity analysis. For every
   * actionable change in the proposal, we perturb the measured lift by
   * small amounts (±5pp in 2.5pp steps) and scale the sample size
   * (±20%), re-running the classifier on each of the 15 resulting
   * cells. The output tells the manager which changes are rock-solid
   * and which are knife's-edge calls. Null when no attribution report
   * yet; empty-report when proposal has no actionable changes.
   */
  const proposalStability = useMemo<ProposalStabilityReport | null>(() => {
    if (!attributionReport || !scorerProposal) return null;
    return computeProposalStability(attributionReport, scorerProposal);
  }, [attributionReport, scorerProposal]);

  /**
   * Slice 20ab — proposal rollback plan. Mirror of the watchlist: for
   * each actionable change, a concrete reversal operation the manager
   * can copy into a future ticket when the watch trips. Priority is
   * inherited from the watchlist entry when one exists (so a
   * watch-escalated weaken rolls back at higher priority than a
   * routine one), else derived from the action verb. Null when no
   * proposal; empty when proposal is all-keep.
   */
  const proposalRollback = useMemo<ProposalRollbackPlan | null>(() => {
    if (!scorerProposal) return null;
    return computeProposalRollback(scorerProposal, proposalWatchlist);
  }, [scorerProposal, proposalWatchlist]);

  /**
   * Slice 20ac — pre-apply checklist. Row-by-row audit trail that
   * composes every upstream signal (sample size, confidence, verdict,
   * stability, what-if, call flips, calibration trend) into a
   * pass/warn/fail/skipped view. The verdict is the "what does the
   * system recommend?" — the checklist is the "did we check
   * everything?" inverse. Readiness pill mirrors verdict most of the
   * time; when they diverge, the row that broke the tie is visible.
   * Null when no proposal; empty when all-keep.
   */
  const proposalPreflight = useMemo<PreflightChecklist | null>(() => {
    if (!scorerProposal) return null;
    return computeProposalPreflightChecklist({
      proposal: scorerProposal,
      confidence: proposalConfidence,
      verdict: proposalVerdict,
      stability: proposalStability,
      whatIf: scorerWhatIf,
      callFlips: proposalCallFlips,
      calibrationDrift,
      dealsAnalyzed: attributionReport?.dealsAnalyzed ?? null,
    });
  }, [
    scorerProposal,
    proposalConfidence,
    proposalVerdict,
    proposalStability,
    scorerWhatIf,
    proposalCallFlips,
    calibrationDrift,
    attributionReport,
  ]);

  /**
   * Slice 20ad — proposal diff vs. the previous session's proposal.
   *
   * Persistence strategy: localStorage keyed by a workspace-neutral
   * key. The snapshot we read is the one captured at MOUNT (not the
   * one we just wrote), so `previousProposal` stays stable for the
   * duration of the session — a reviewer reading the diff doesn't
   * see it collapse to empty a second after it renders.
   *
   * On every proposal update we write the latest snapshot, so the
   * NEXT session reads it as "previous". First-ever mount sees null
   * and the diff renders as "no prior" (muted); subsequent mounts
   * see the real diff.
   *
   * No-ops safely in SSR / test environments without localStorage.
   */
  const STORAGE_KEY = "qep.quote-builder.proposal-last-snapshot";
  const previousProposal = useMemo<ScorerProposal | null>(() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return null;
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ScorerProposal;
      // Basic shape guard — if stored schema drifted, drop it quietly
      // rather than crash the page.
      if (!parsed || !Array.isArray(parsed.changes)) return null;
      return parsed;
    } catch {
      return null;
    }
    // Intentionally run once at mount — `previousProposal` must stay
    // pinned to the mount-time snapshot so the diff doesn't collapse
    // when we write the new snapshot below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      if (!scorerProposal) return;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scorerProposal));
    } catch {
      // localStorage can throw on quota exceeded / private-browsing;
      // the diff degrades silently rather than blocking the page.
    }
  }, [scorerProposal]);

  const proposalDiff = useMemo<ProposalDiff | null>(() => {
    if (!scorerProposal) return null;
    return computeProposalDiff(previousProposal, scorerProposal);
  }, [previousProposal, scorerProposal]);

  /**
   * Slice 20ae — rolling N-session history for consolidation / Lindy
   * streaks. Sits alongside the pairwise-diff snapshot above rather
   * than replacing it: 20ad wants exactly one prior snapshot pinned
   * at mount; 20ae wants a list of the last N (most recent first).
   *
   * We keep the two storage keys separate so each slice stays
   * independently debuggable — an operator clearing one doesn't
   * secretly break the other. Both no-op safely when localStorage
   * is unavailable; quota-exceeded degrades silently.
   *
   * Window size of 5 is deliberate: 4 is the "consolidated" threshold,
   * so storing 5 gives one session of headroom — a call that has
   * appeared in 4 of 5 slots reads as consolidated; 5 of 5 reinforces
   * the rating without changing it. Larger windows would dilute
   * "consolidated" into "appeared once in a distant past" which is
   * exactly the false-signal the band is built to avoid.
   */
  const HISTORY_STORAGE_KEY = "qep.quote-builder.proposal-history";
  const HISTORY_WINDOW = 5;
  const proposalHistory = useMemo<ScorerProposal[]>(() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return [];
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ScorerProposal[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (p): p is ScorerProposal => !!p && Array.isArray(p.changes),
      );
    } catch {
      return [];
    }
    // Pin at mount — same rationale as `previousProposal`: the
    // consolidation report must not collapse when we write the new
    // snapshot to the rolling buffer below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      if (!scorerProposal) return;
      // Prepend the new snapshot and keep only the last N entries.
      // Reading from localStorage fresh (not the mount-time value)
      // ensures cross-tab sessions don't clobber each other's
      // history by writing stale state.
      const rawExisting = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      const existing: ScorerProposal[] = rawExisting
        ? (JSON.parse(rawExisting) as ScorerProposal[]).filter(
            (p): p is ScorerProposal => !!p && Array.isArray(p.changes),
          )
        : [];
      const next = [scorerProposal, ...existing].slice(0, HISTORY_WINDOW);
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // quota / private-browsing — degrade silently, the consolidation
      // row will just read `windowSize=0` on the next mount.
    }
  }, [scorerProposal]);

  const proposalConsolidation = useMemo<ProposalConsolidationReport | null>(() => {
    if (!scorerProposal) return null;
    return computeProposalConsolidation(proposalHistory, scorerProposal);
  }, [proposalHistory, scorerProposal]);

  /**
   * Slice 20af — streak breaks. Cross-references the pairwise diff
   * (20ad) with the rolling history (20ae) to surface calls that
   * were previously consolidated or consistent and just broke. A
   * tier-1 alert: a consolidated call flipping is materially louder
   * than a fresh call moving.
   *
   * Reuses the same `proposalHistory` snapshot pinned at mount, so
   * this report is consistent with the consolidation row above it.
   * Null when no proposal; empty when nothing broke.
   */
  const proposalStreakBreaks = useMemo<ProposalStreakBreakReport | null>(() => {
    if (!scorerProposal) return null;
    return computeProposalStreakBreaks(proposalHistory, scorerProposal);
  }, [proposalHistory, scorerProposal]);

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
          callFlips={proposalCallFlips}
          verdict={proposalVerdict}
          watchlist={proposalWatchlist}
          stability={proposalStability}
          rollback={proposalRollback}
          preflight={proposalPreflight}
          diff={proposalDiff}
          consolidation={proposalConsolidation}
          streakBreaks={proposalStreakBreaks}
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
  callFlips,
  verdict,
  watchlist,
  stability,
  rollback,
  preflight,
  diff,
  consolidation,
  streakBreaks,
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
  /** Slice 20w — per-deal call flips. The concrete version of 20p's
   *  aggregate Brier delta: which specific closed deals would flip
   *  verdict, and did the flip agree with reality? Rendered in the
   *  expanded panel so the manager can eyeball the exact deals
   *  before approving. Null when what-if is unavailable or the
   *  proposal has no actionable changes. */
  callFlips: ProposalCallFlipReport | null;
  /** Slice 20y — composed apply/review/hold/defer verdict. The busy-
   *  manager summary that sits on top of the evidence chain: the card
   *  renders the pill + headline + ranked reasons so a reviewer can
   *  read the recommendation first and the receipts below it. Null
   *  when no proposal exists at all. */
  verdict: ProposalApplyVerdict | null;
  /** Slice 20z — post-apply watchlist. Per-factor monitoring plan
   *  ranked by priority (high/medium/low) with concrete reconsider
   *  triggers. Rendered in the expanded panel and woven into the
   *  clipboard markdown so the ticket carries an actionable checklist
   *  for the N days after the proposal lands. Null when no proposal. */
  watchlist: ProposalWatchlist | null;
  /** Slice 20aa — proposal stability / sensitivity report: for every
   *  actionable change, stability fraction under small lift + sample
   *  perturbations, plus aggregate rating. The card renders an
   *  emerald/amber/rose pill in the header and a per-change row list
   *  in the expanded panel so the manager can see which pieces of the
   *  proposal are rock-solid and which are knife's-edge calls. Null
   *  when we don't have attribution data yet; empty-report is handled. */
  stability: ProposalStabilityReport | null;
  /** Slice 20ab — rollback plan. Per-actionable-change reversal
   *  operation with priority inherited from the watchlist when a
   *  matching entry exists. Rendered directly below the watchlist in
   *  the expanded panel so the manager reads "what to watch" and
   *  "how to unwind" adjacent. Null when no proposal; empty when
   *  proposal has no actionable changes. */
  rollback: ProposalRollbackPlan | null;
  /** Slice 20ac — pre-apply audit checklist. Row-by-row pass/warn/fail/
   *  skipped view of every pre-flight gate (sample, confidence, verdict,
   *  stability, what-if, call flips, calibration trend) + an overall
   *  readiness pill. Woven into the card header (readiness pill) and
   *  the expanded panel (per-row audit trail) so the manager sees the
   *  gates that produced the verdict alongside the verdict itself.
   *  Null when no proposal; empty when the proposal has no actionable
   *  changes. */
  preflight: PreflightChecklist | null;
  /** Slice 20ad — proposal diff vs. the previous session's proposal.
   *  The time-series view on top of every cross-sectional slice: "is
   *  this call the same as last time, a drifting one, or a thrashing
   *  one?" Rendered as a header pill next to readiness and as an
   *  explicit added/removed/changed row list in the expanded panel so
   *  a reviewer can distinguish "consistent finding earning trust"
   *  from "noisy knee-jerk." Null when no proposal; empty when the
   *  previous snapshot doesn't exist yet or the proposals are
   *  content-identical (though `headline` still signals stability). */
  diff: ProposalDiff | null;
  /** Slice 20ae — N-session consolidation / Lindy streak. For every
   *  actionable change in the current proposal, how many consecutive
   *  sessions it has been consistent. 20ad answers "did this move
   *  since last session?"; 20ae answers "has this been stable for N
   *  sessions running?" A reviewer sees both — a call that's been
   *  consistent for 4+ sessions earns Lindy weight, a brand-new call
   *  is flagged as fresh evidence. Null when no proposal; empty when
   *  the proposal has no actionable changes. */
  consolidation: ProposalConsolidationReport | null;
  /** Slice 20af — streak-break alert. Cross-references the pairwise
   *  diff (20ad) with the rolling history (20ae) to surface
   *  previously-consolidated or consistent calls that just broke.
   *  A distinct tier-1 alert because a 4-session Lindy call flipping
   *  is materially louder than a fresh call moving. Null when no
   *  proposal; empty when nothing broke. */
  streakBreaks: ProposalStreakBreakReport | null;
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
      // Slice 20u/20x/20y/20z — the clipboard carries the full evidence
      // chain: the 20y verdict on top (apply/review/hold/defer + ranked
      // reasons), then urgency, calibration drift, factor drift,
      // what-if, per-deal call flips (20w), confidence (20v), the
      // post-apply watchlist (20z), and finally the proposal body.
      // The context renderer falls through to the bare 20m output
      // when every section is silent, so nothing bloats the ticket
      // without earning it.
      const markdown = renderProposalMarkdownWithContext(proposal, {
        calibrationDrift,
        factorDrift,
        urgency,
        whatIf,
        confidence,
        callFlips,
        verdict,
        watchlist,
        stability,
        rollback,
        preflight,
        diff,
        consolidation,
        streakBreaks,
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
              {/* Slice 20y — apply verdict pill. The busy-manager
                  decision on top of urgency + confidence. Apply=emerald,
                  review=amber, hold=rose, defer=muted. Tooltip carries
                  the ranked headline so hovering reveals the one-line
                  reason without the reader having to expand the card. */}
              {verdict && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${
                    verdict.verdict === "apply"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : verdict.verdict === "review"
                        ? "bg-amber-500/15 text-amber-300"
                        : verdict.verdict === "hold"
                          ? "bg-rose-500/15 text-rose-300"
                          : "bg-muted/30 text-muted-foreground"
                  }`}
                  aria-label={`Apply verdict: ${verdict.verdict} — ${verdict.headline}`}
                  title={verdict.headline}
                >
                  {describeProposalVerdictPill(verdict.verdict)}
                </span>
              )}
              {/* Slice 20aa — stability pill. Sits last in the pill
                  row because it's the "kick the tires" signal — after
                  urgency (when), confidence (how much to trust), and
                  verdict (what to do), stability answers "is the call
                  itself robust?". Hidden when empty (no actionable
                  changes) or null (no attribution data) so the row
                  doesn't show a meaningless "NO DATA" chip. */}
              {stability && !stability.empty && stability.rating !== null && (() => {
                const pill = describeStabilityPill(stability);
                const cls =
                  pill.tone === "emerald"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : pill.tone === "amber"
                      ? "bg-amber-500/15 text-amber-300"
                      : pill.tone === "rose"
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-muted/30 text-muted-foreground";
                return (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${cls}`}
                    aria-label={`Stability: ${stability.rating} — ${stability.headline ?? ""}`}
                    title={stability.headline ?? ""}
                  >
                    {pill.label}
                  </span>
                );
              })()}
              {/* Slice 20ac — readiness pill. The "did we check
                  everything?" counterpart to the verdict pill. Green/
                  amber/rose mirrors the derived readiness (ready/review/
                  hold) which is structurally derived from the
                  pass/warn/fail row counts — so if the verdict says
                  "apply" but a single gate failed, the readiness pill
                  will say HOLD and force a second look. Hidden when
                  empty (no proposal / all-keep). */}
              {preflight && !preflight.empty && (() => {
                const pill = describeReadinessPill(preflight.readiness);
                const cls =
                  pill.tone === "emerald"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : pill.tone === "amber"
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-rose-500/15 text-rose-300";
                return (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${cls}`}
                    aria-label={`Pre-flight readiness: ${preflight.readiness} — ${preflight.headline ?? ""}`}
                    title={preflight.headline ?? ""}
                  >
                    {pill.label}
                  </span>
                );
              })()}
              {/* Slice 20ad — proposal-diff pill. Answers the "is the
                  scorer thrashing?" question at a glance. Emerald STABLE
                  means "same call as last session, trust earned", amber
                  EVOLVING means "small drift, kick the tires", rose
                  THRASHING means "3+ rows changed, do NOT act on this
                  like you'd act on a stable finding", muted "— no prior"
                  means first-ever mount with nothing to compare against.
                  Hidden when diff is null (no proposal) so we don't
                  stack an always-muted pill on every reader. */}
              {/* Slice 20af — streak-break pill. Rendered immediately
                  before the diff pill because it's the tier-1 version
                  of the same "what moved?" question: "what moved that
                  was previously CONSOLIDATED or CONSISTENT?" Hidden
                  when empty — we don't want a muted chip stacked every
                  session for the 90% of sessions where nothing broke. */}
              {streakBreaks && !streakBreaks.empty && (() => {
                const pill = describeStreakBreaksPill(streakBreaks);
                const cls =
                  pill.tone === "rose"
                    ? "bg-rose-500/15 text-rose-300"
                    : pill.tone === "amber"
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-muted/30 text-muted-foreground";
                return (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${cls}`}
                    aria-label={`Streak breaks: ${pill.label} — ${streakBreaks.headline ?? ""}`}
                    title={streakBreaks.headline ?? ""}
                  >
                    {pill.label}
                  </span>
                );
              })()}
              {diff && (() => {
                const pill = describeProposalDiffPill(diff);
                const cls =
                  pill.tone === "emerald"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : pill.tone === "amber"
                      ? "bg-amber-500/15 text-amber-300"
                      : pill.tone === "rose"
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-muted/30 text-muted-foreground";
                return (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${cls}`}
                    aria-label={`Proposal drift: ${pill.label} — ${diff.headline ?? "no prior session"}`}
                    title={diff.headline ?? "No prior session to compare against."}
                  >
                    {pill.label}
                  </span>
                );
              })()}
              {/* Slice 20ae — consolidation / Lindy streak pill. Sits
                  next to the diff pill because the two form a pair:
                  diff is the pairwise time-series (did it move since
                  last session?), consolidation is the N-session view
                  (has it been consistent for many?). Emerald
                  CONSOLIDATED means most calls have streak ≥ 4 — the
                  proposal is Lindy-weighted; sky CONSISTENT means most
                  are 2-3; amber FRESH means majority are brand-new;
                  muted "— no history" means this is the first-ever
                  mount. Hidden when empty (no actionable changes). */}
              {consolidation && !consolidation.empty && (() => {
                const pill = describeConsolidationPill(consolidation);
                const cls =
                  pill.tone === "emerald"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : pill.tone === "sky"
                      ? "bg-sky-500/15 text-sky-300"
                      : pill.tone === "amber"
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-muted/30 text-muted-foreground";
                return (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide tabular-nums ${cls}`}
                    aria-label={`Consolidation: ${pill.label} — ${consolidation.headline ?? "no prior history"}`}
                    title={consolidation.headline ?? "No prior sessions to consolidate against."}
                  >
                    {pill.label}
                  </span>
                );
              })()}
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
              {/* Slice 20y — apply verdict + ranked reasons. Rendered FIRST
                  in the expanded body because the verdict is the busy-
                  manager summary of everything below; the evidence cards
                  justify WHY, not WHAT. Polarity icon colors match the
                  card's accent grammar: emerald=positive, rose=negative,
                  muted=neutral. Hidden when verdict is null (no proposal
                  at all) — defer with an empty reasons list still renders
                  the headline so the manager sees "nothing to apply." */}
              {verdict && (
                <div
                  className={`rounded border p-2 ${
                    verdict.verdict === "apply"
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : verdict.verdict === "review"
                        ? "border-amber-500/20 bg-amber-500/5"
                        : verdict.verdict === "hold"
                          ? "border-rose-500/20 bg-rose-500/5"
                          : "border-muted/30 bg-muted/5"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div
                      className={`text-[10px] font-semibold uppercase tracking-wide ${
                        verdict.verdict === "apply"
                          ? "text-emerald-400"
                          : verdict.verdict === "review"
                            ? "text-amber-400"
                            : verdict.verdict === "hold"
                              ? "text-rose-400"
                              : "text-muted-foreground"
                      }`}
                    >
                      Apply verdict
                    </div>
                    <div className="text-[10px] tabular-nums text-muted-foreground">
                      {describeProposalVerdictPill(verdict.verdict)}
                    </div>
                  </div>
                  <p className="mt-0.5 text-[11px] text-foreground">
                    {verdict.headline}
                  </p>
                  {verdict.reasons.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {verdict.reasons.map((r, i) => (
                        <li
                          key={`${r.kind}-${i}`}
                          className="flex items-start gap-2 text-[10px] text-muted-foreground"
                        >
                          <span
                            className={`shrink-0 font-semibold ${
                              r.polarity === "positive"
                                ? "text-emerald-400"
                                : r.polarity === "negative"
                                  ? "text-rose-400"
                                  : "text-muted-foreground"
                            }`}
                            aria-label={`polarity ${r.polarity}`}
                          >
                            {r.polarity === "positive"
                              ? "✓"
                              : r.polarity === "negative"
                                ? "⚠"
                                : "·"}
                          </span>
                          <span className="flex-1">{r.rationale}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {/* Slice 20af — streak-break row. Tier-1 alert directly
                  above the diff: a consolidated call breaking is
                  materially louder than generic drift. Hidden when
                  empty (nothing broke this session). */}
              {streakBreaks && !streakBreaks.empty && (
                <ScorerProposalStreakBreaksRow streakBreaks={streakBreaks} />
              )}
              {/* Slice 20ad — proposal diff row. Sits between the
                  verdict and the pre-apply checklist to match the
                  markdown order: after the cross-sectional "what the
                  scorer recommends right now", before the audit trail
                  that justifies it, comes the time-series question "and
                  is this the same recommendation it made last session?"
                  A reviewer sees drift context BEFORE they assess the
                  gates, because drift changes how much weight to put on
                  the gates themselves. Hidden when the diff has no
                  headline (no prior snapshot + no stable-with-unchanged
                  copy) so we don't render a dead box. */}
              {diff && diff.headline && (
                <ScorerProposalDiffRow diff={diff} />
              )}
              {/* Slice 20ae — consolidation / Lindy streak row. Directly
                  under the diff because the pair answers two questions
                  about the same time axis: 20ad reports pairwise drift
                  ("what moved this session"), 20ae reports N-session
                  consolidation ("which specific calls have been consistent
                  across the window"). A reader on a consolidated row
                  gives the call Lindy weight; on a fresh row, they know
                  to wait for more sessions before acting strongly. */}
              {consolidation && !consolidation.empty && consolidation.headline && (
                <ScorerProposalConsolidationRow consolidation={consolidation} />
              )}
              {/* Slice 20ac — pre-apply checklist. Pinned directly
                  under the verdict because it IS the audit trail that
                  produced the verdict — row-by-row pass/warn/fail/
                  skipped view across every pre-flight gate. A reader
                  who sees "apply" on the verdict can scan the rows and
                  confirm every gate said yes; a reader who sees "hold"
                  can see exactly which gate failed. Hidden when the
                  checklist is empty (no proposal / all-keep). */}
              {preflight && !preflight.empty && preflight.items.length > 0 && (
                <ScorerProposalPreflightRow preflight={preflight} />
              )}
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
              {/* Slice 20w — per-deal call flips. The concrete evidence
                  for (or against) the aggregate what-if number above.
                  Rendered whenever we have a report — including the
                  zero-flip case ("proposal refines scores without
                  changing any verdicts"), because that's still a fact
                  the manager wants to know before approving. */}
              {callFlips && <ScorerProposalCallFlipsRow report={callFlips} />}
              {/* Slice 20aa — proposal stability / sensitivity row.
                  Sits just above the watchlist because it answers "is
                  the decision robust?" and the watchlist answers "what
                  do I monitor after applying?". A fragile stability
                  rating should make the manager read the watchlist
                  more carefully. Hidden when the report is empty / no
                  actionable changes — same fall-through grammar as the
                  watchlist row. */}
              {stability && !stability.empty && stability.changes.length > 0 && (
                <ScorerProposalStabilityRow stability={stability} />
              )}
              {/* Slice 20z — post-apply watchlist. Rendered below the
                  call-flips so a reviewer reads the decision signals
                  first ("here's what the proposal does") and THEN the
                  monitoring plan ("here's what to check after applying").
                  Hidden when the watchlist has no items — a well-sampled
                  strengthen proposal with stable drift doesn't need a
                  post-apply todo list. */}
              {watchlist && watchlist.items.length > 0 && (
                <ScorerProposalWatchlistRow watchlist={watchlist} />
              )}
              {/* Slice 20ab — rollback plan. Adjacent to the watchlist
                  because they are the matched pair: one says what to
                  watch, the other says how to unwind. Hidden when the
                  plan is empty (no actionable changes) so all-keep
                  proposals don't render a stub section. */}
              {rollback && !rollback.empty && rollback.steps.length > 0 && (
                <ScorerProposalRollbackRow rollback={rollback} />
              )}
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
 * Slice 20w — per-deal call-flip evidence rendered inside the expanded
 * ScorerProposalCard panel.
 *
 * Composition:
 *   • One headline line (`describeCallFlipsHeadline`) that reads like
 *     a verdict sentence ("2 corroborating, 1 regressing (net +1…)").
 *   • Two bucket stacks underneath — emerald for corroborating,
 *     rose for regressing. Either bucket may be empty; when both are
 *     empty we still show the headline ("proposal refines scores
 *     without changing any verdicts") because that's a useful fact.
 *
 * We intentionally don't render the unchanged-call totals as rows —
 * they're in the headline as context but surfacing 25 unchanged deals
 * would drown the 1 regressing deal that actually needs eyeballing.
 *
 * Accessibility: the buckets are ordered corroborating-then-regressing
 * in DOM, and each row includes an aria-label that spells out the
 * package id, outcome, and score transition so a screen reader gets
 * the full flip story without relying on color alone.
 */
function ScorerProposalCallFlipsRow({
  report,
}: {
  report: ProposalCallFlipReport;
}) {
  const headline = describeCallFlipsHeadline(report);
  if (!headline) return null;

  const showCorroborating = report.corroborating.length > 0;
  const showRegressing = report.regressing.length > 0;

  return (
    <div
      className="rounded border border-violet-500/15 bg-background/40 p-2"
      role="region"
      aria-label="Per-deal call flips"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
          Call flips
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {report.resolvedCount} resolved · {report.expiredCount} expired
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-foreground">{headline}</p>
      {(showCorroborating || showRegressing) && (
        <div className="mt-1.5 space-y-1.5">
          {showCorroborating && (
            <CallFlipBucket
              label="Corroborating — proposal calls the outcome right"
              flips={report.corroborating}
              tone="emerald"
            />
          )}
          {showRegressing && (
            <CallFlipBucket
              label="Regressing — proposal would get the call wrong"
              flips={report.regressing}
              tone="rose"
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Slice 20z — post-apply watchlist row inside the ScorerProposalCard.
 *
 * Lists each factor the manager should monitor after applying, with
 * its action verb, priority badge (🔴/🟡/⚪ matching the markdown
 * copy), concern, and reconsideration trigger. The reasoning behind
 * "concern + trigger" rather than just "concern": the trigger tells
 * the manager exactly what data point would change their mind, so
 * when they come back in 30 days they know WHAT to look at, not
 * just THAT something needs looking at.
 *
 * Visual design stays subdued — a neutral muted border, same tone
 * as the call-flips row. Post-apply monitoring is important but
 * it's not a change-the-color-of-the-card signal; the verdict
 * already did that.
 */
function ScorerProposalWatchlistRow({
  watchlist,
}: {
  watchlist: ProposalWatchlist;
}) {
  return (
    <div
      className="rounded border border-violet-500/15 bg-background/40 p-2"
      role="region"
      aria-label="Post-apply watchlist"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
          Post-apply watchlist
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {watchlist.items.length} to monitor
        </div>
      </div>
      {watchlist.headline && (
        <p className="mt-0.5 text-[11px] text-foreground">{watchlist.headline}</p>
      )}
      <ul className="mt-1.5 space-y-1.5">
        {watchlist.items.map((item, i) => {
          const priorityTone =
            item.priority === "high"
              ? { icon: "🔴", color: "text-rose-300" }
              : item.priority === "medium"
                ? { icon: "🟡", color: "text-amber-300" }
                : { icon: "⚪", color: "text-muted-foreground" };
          return (
            <li
              key={`${item.label}-${i}`}
              className="border-l border-violet-500/20 pl-2"
              aria-label={`Watch ${item.label}: ${item.action}, ${item.priority} priority`}
            >
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className={priorityTone.color}>{priorityTone.icon}</span>
                <span className="font-mono text-foreground truncate" title={item.label}>
                  {item.label}
                </span>
                <span className="text-muted-foreground">· {item.action}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                <span className="text-foreground">Concern:</span> {item.concern}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                <span className="text-foreground">Trigger:</span> {item.trigger}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Slice 20ab — rollback plan row inside the ScorerProposalCard.
 *
 * Companion to the watchlist row: the watchlist says "here is what
 * to monitor after applying," and this row says "here is exactly
 * how to unwind each piece." Cross-linked items carry a 👁 badge so
 * the manager can tell at a glance which rollback steps are on-call
 * responses to active watches vs. hypothetical plans.
 *
 * Same neutral muted border as the watchlist row — the rollback plan
 * is informational, not a state change on the card.
 */
function ScorerProposalRollbackRow({
  rollback,
}: {
  rollback: ProposalRollbackPlan;
}) {
  return (
    <div
      className="rounded border border-violet-500/15 bg-background/40 p-2"
      role="region"
      aria-label="Proposal rollback plan"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
          Rollback plan
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {rollback.steps.length} step{rollback.steps.length === 1 ? "" : "s"}
        </div>
      </div>
      {rollback.headline && (
        <p className="mt-0.5 text-[11px] text-foreground">{rollback.headline}</p>
      )}
      <ul className="mt-1.5 space-y-1.5">
        {rollback.steps.map((step, i) => {
          const priorityTone =
            step.priority === "high"
              ? { icon: "🔴", color: "text-rose-300" }
              : step.priority === "medium"
                ? { icon: "🟡", color: "text-amber-300" }
                : { icon: "⚪", color: "text-muted-foreground" };
          return (
            <li
              key={`${step.label}-${i}`}
              className="border-l border-violet-500/20 pl-2"
              aria-label={`Rollback ${step.label}: ${step.action}, ${step.priority} priority${step.hasWatchTrigger ? ", cross-linked to watchlist" : ""}`}
            >
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className={priorityTone.color}>{priorityTone.icon}</span>
                <span
                  className="font-mono text-foreground truncate"
                  title={step.label}
                >
                  {step.label}
                </span>
                <span className="text-muted-foreground">· {step.action}</span>
                {step.hasWatchTrigger && (
                  <span
                    className="ml-auto text-[9px] text-violet-300"
                    title="Cross-linked to the watchlist — this rollback is the on-call response to an active watch."
                  >
                    👁 watched
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                <span className="text-foreground">Operation:</span>{" "}
                {step.operation}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                <span className="text-foreground">Impact:</span> {step.impact}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Slice 20ac — pre-apply checklist row inside the ScorerProposalCard.
 *
 * The row-by-row audit trail that produced the verdict. Each gate
 * (sample, confidence, verdict, stability, what-if, call flips,
 * calibration trend) renders as one line with:
 *
 *   • status icon — ✓ emerald (pass), ⚠ amber (warn), ✗ rose (fail),
 *                   · muted (skipped)
 *   • label       — "Sample adequate", "Confidence", etc.
 *   • evidence    — the specific number or state that gave the row
 *                   its status ("72/100 (high)", "apply", "−0.034 Brier")
 *
 * The headline summarises the counts ("Ready to apply — 5 passed, 2
 * skipped.") and the readiness pill in the card header mirrors the
 * derived readiness band. A manager who sees "hold" on the header pill
 * scans these rows to find the specific gate that failed; a manager
 * who sees "ready" uses them as corroborating receipts.
 */
function ScorerProposalPreflightRow({
  preflight,
}: {
  preflight: PreflightChecklist;
}) {
  const readinessPill = describeReadinessPill(preflight.readiness);
  const borderCls =
    readinessPill.tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : readinessPill.tone === "amber"
        ? "border-amber-500/20 bg-amber-500/5"
        : "border-rose-500/20 bg-rose-500/5";
  const headerCls =
    readinessPill.tone === "emerald"
      ? "text-emerald-400"
      : readinessPill.tone === "amber"
        ? "text-amber-400"
        : "text-rose-400";
  return (
    <div
      className={`rounded border p-2 ${borderCls}`}
      role="region"
      aria-label={`Pre-apply checklist (${preflight.readiness})`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${headerCls}`}>
          Pre-apply checklist
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {readinessPill.label}
        </div>
      </div>
      {preflight.headline && (
        <p className="mt-0.5 text-[11px] text-foreground">{preflight.headline}</p>
      )}
      <ul className="mt-1.5 space-y-0.5">
        {preflight.items.map((item) => {
          const statusTone =
            item.status === "pass"
              ? { icon: "✓", color: "text-emerald-400" }
              : item.status === "warn"
                ? { icon: "⚠", color: "text-amber-400" }
                : item.status === "fail"
                  ? { icon: "✗", color: "text-rose-400" }
                  : { icon: "·", color: "text-muted-foreground" };
          return (
            <li
              key={item.id}
              className="flex items-start gap-2 text-[10px]"
              aria-label={`${item.label}: ${item.status} — ${item.evidence}`}
            >
              <span
                className={`shrink-0 font-semibold ${statusTone.color}`}
                aria-hidden
              >
                {statusTone.icon}
              </span>
              <span className="shrink-0 text-foreground">{item.label}</span>
              <span className="flex-1 text-muted-foreground">
                — {item.evidence}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Slice 20af — streak-breaks row inside the ScorerProposalCard.
 *
 * Tier-1 alert. Cross-references the pairwise diff (20ad) with the
 * rolling history (20ae) and surfaces calls that were previously
 * consolidated (streak ≥ 4) or consistent (2-3) and just broke.
 *
 *   ⚡ rose  — consolidated break (was Lindy, now moved)
 *   ↯ amber — consistent break (was 2-3 sessions, now moved)
 *
 * The row exists specifically to distinguish "the scorer just
 * re-thought a time-tested finding" from "a fresh recommendation
 * moved" — both show up in the 20ad diff but deserve different
 * weight from the reviewer. The `was consistent for N sessions`
 * evidence tail surfaces the streak length so the magnitude is
 * explicit, not implied.
 *
 * Entries are pre-sorted by the lib (longest streak first, label
 * alpha tie-break), so the biggest broken Lindy call renders at
 * the top — exactly where the manager's eye should go.
 */
function ScorerProposalStreakBreaksRow({
  streakBreaks,
}: {
  streakBreaks: ProposalStreakBreakReport;
}) {
  const pill = describeStreakBreaksPill(streakBreaks);
  const borderCls =
    pill.tone === "rose"
      ? "border-rose-500/30 bg-rose-500/10"
      : pill.tone === "amber"
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-muted/30 bg-muted/5";
  const headerCls =
    pill.tone === "rose"
      ? "text-rose-400"
      : pill.tone === "amber"
        ? "text-amber-400"
        : "text-muted-foreground";
  return (
    <div
      className={`rounded border p-2 ${borderCls}`}
      role="region"
      aria-label={`Streak breaks (${pill.label})`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${headerCls}`}>
          Streak breaks
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {pill.label}
        </div>
      </div>
      {streakBreaks.headline && (
        <p className="mt-0.5 text-[11px] text-foreground">
          {streakBreaks.headline}
        </p>
      )}
      {streakBreaks.entries.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {streakBreaks.entries.map((e) => {
            const glyph =
              e.kind === "consolidated-break"
                ? { char: "⚡", color: "text-rose-400" }
                : { char: "↯", color: "text-amber-400" };
            const arrow =
              e.currentAction === null
                ? "removed"
                : `→ ${e.currentAction}`;
            return (
              <li
                key={`${e.label}-${e.previousAction}`}
                className="flex items-start gap-2 text-[10px]"
                aria-label={`${e.label} · ${e.previousAction} ${arrow} · was consistent for ${e.priorStreak} sessions`}
              >
                <span
                  className={`shrink-0 font-semibold ${glyph.color}`}
                  aria-hidden
                >
                  {glyph.char}
                </span>
                <span className="shrink-0 text-foreground">{e.label}</span>
                <span className="flex-1 text-muted-foreground">
                  — {e.previousAction} {arrow} · was consistent for{" "}
                  {e.priorStreak} session{e.priorStreak === 1 ? "" : "s"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Slice 20ad — proposal-diff row inside the ScorerProposalCard.
 *
 * Time-series complement to every cross-sectional row above. The
 * upstream slices (confidence, verdict, stability, preflight) all
 * answer "what is the scorer saying, and how much should we trust
 * it right now?". This row answers "is the scorer saying the SAME
 * thing it said last session, or is it oscillating?" — a consistent
 * finding across sessions earns trust differently than a knee-jerk.
 *
 *   • STABLE (emerald) — no drift. The "Proposal stable since last
 *     session — N unchanged calls." case, which is itself a signal
 *     worth seeing explicitly, not just absence of noise.
 *   • EVOLVING (amber) — 1-2 rows drifted. Worth a second look but
 *     not alarming; the rows list tells the reviewer which specific
 *     calls moved.
 *   • THRASHING (rose) — 3+ rows drifted. The scorer is not stable
 *     enough to act on with the same confidence as a consistent
 *     call; the header pill and this row force the reviewer to
 *     slow down.
 *   • muted "no prior" — first-ever mount with nothing to compare
 *     against. Explicit rather than silent so a reader doesn't
 *     mistake "no prior" for "stable".
 *
 * Categories render in the fixed order added / removed / changed
 * (matches the markdown + the natural "what's new / gone / moved"
 * skim order).
 */
function ScorerProposalDiffRow({
  diff,
}: {
  diff: ProposalDiff;
}) {
  const pill = describeProposalDiffPill(diff);
  const borderCls =
    pill.tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : pill.tone === "amber"
        ? "border-amber-500/20 bg-amber-500/5"
        : pill.tone === "rose"
          ? "border-rose-500/20 bg-rose-500/5"
          : "border-muted/30 bg-muted/5";
  const headerCls =
    pill.tone === "emerald"
      ? "text-emerald-400"
      : pill.tone === "amber"
        ? "text-amber-400"
        : pill.tone === "rose"
          ? "text-rose-400"
          : "text-muted-foreground";
  return (
    <div
      className={`rounded border p-2 ${borderCls}`}
      role="region"
      aria-label={`Proposal drift vs last session (${pill.label})`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${headerCls}`}>
          Proposal diff vs last session
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {pill.label}
        </div>
      </div>
      {diff.headline && (
        <p className="mt-0.5 text-[11px] text-foreground">{diff.headline}</p>
      )}
      {(diff.addedFactors.length > 0 ||
        diff.removedFactors.length > 0 ||
        diff.changedActions.length > 0) && (
        <ul className="mt-1.5 space-y-0.5">
          {diff.addedFactors.map((label) => (
            <li
              key={`added-${label}`}
              className="flex items-start gap-2 text-[10px]"
              aria-label={`New call: ${label}`}
            >
              <span className="shrink-0 font-semibold text-emerald-400" aria-hidden>
                ➕
              </span>
              <span className="shrink-0 text-foreground">New call</span>
              <span className="flex-1 text-muted-foreground">— {label}</span>
            </li>
          ))}
          {diff.removedFactors.map((label) => (
            <li
              key={`removed-${label}`}
              className="flex items-start gap-2 text-[10px]"
              aria-label={`Dropped from proposal: ${label}`}
            >
              <span className="shrink-0 font-semibold text-rose-400" aria-hidden>
                ➖
              </span>
              <span className="shrink-0 text-foreground">Dropped</span>
              <span className="flex-1 text-muted-foreground">— {label}</span>
            </li>
          ))}
          {diff.changedActions.map((c) => (
            <li
              key={`changed-${c.label}`}
              className="flex items-start gap-2 text-[10px]"
              aria-label={`Action moved on ${c.label}: ${c.previousAction} to ${c.currentAction}`}
            >
              <span className="shrink-0 font-semibold text-amber-400" aria-hidden>
                ↻
              </span>
              <span className="shrink-0 text-foreground">Action moved</span>
              <span className="flex-1 text-muted-foreground">
                — {c.label} · {c.previousAction} → {c.currentAction}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Slice 20ae — consolidation / Lindy streak row inside the
 * ScorerProposalCard.
 *
 * Companion to the 20ad diff row above. While 20ad answers the
 * pairwise question ("did anything move since last session?"), 20ae
 * answers the N-session version: "which calls have been consistent
 * for many sessions running?" A call consolidated across 4 sessions
 * has earned Lindy weight — the longer it stays consistent, the
 * more trust the reviewer can place in it independent of any
 * single session's evidence.
 *
 * Glyph + tone grammar mirrors the pill:
 *   ◆ emerald — consolidated (streak ≥ 4)
 *   ≡ sky     — consistent (streak 2–3)
 *   ✦ amber   — new (streak = 1)
 *
 * The "new" band is intentionally amber rather than rose: a new call
 * is not bad, it's just untested by time. The reviewer should weigh
 * it against the cross-sectional evidence (stability, confidence)
 * without the extra Lindy boost a consolidated call would earn.
 *
 * Entries are pre-sorted by the lib (consolidated first, then
 * consistent, then new) so the UI renders the most-trusted calls at
 * the top of the list.
 */
function ScorerProposalConsolidationRow({
  consolidation,
}: {
  consolidation: ProposalConsolidationReport;
}) {
  const pill = describeConsolidationPill(consolidation);
  const borderCls =
    pill.tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : pill.tone === "sky"
        ? "border-sky-500/20 bg-sky-500/5"
        : pill.tone === "amber"
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-muted/30 bg-muted/5";
  const headerCls =
    pill.tone === "emerald"
      ? "text-emerald-400"
      : pill.tone === "sky"
        ? "text-sky-400"
        : pill.tone === "amber"
          ? "text-amber-400"
          : "text-muted-foreground";
  return (
    <div
      className={`rounded border p-2 ${borderCls}`}
      role="region"
      aria-label={`Consolidation across last ${consolidation.windowSize} sessions (${pill.label})`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${headerCls}`}>
          Consolidation · last {consolidation.windowSize} session
          {consolidation.windowSize === 1 ? "" : "s"}
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {pill.label}
        </div>
      </div>
      {consolidation.headline && (
        <p className="mt-0.5 text-[11px] text-foreground">
          {consolidation.headline}
        </p>
      )}
      {consolidation.entries.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {consolidation.entries.map((e) => {
            const glyph =
              e.band === "consolidated"
                ? { char: "◆", color: "text-emerald-400" }
                : e.band === "consistent"
                  ? { char: "≡", color: "text-sky-400" }
                  : { char: "✦", color: "text-amber-400" };
            return (
              <li
                key={`${e.label}-${e.action}`}
                className="flex items-start gap-2 text-[10px]"
                aria-label={`${e.label} · ${e.action} · ${e.streak} session${e.streak === 1 ? "" : "s"} · ${e.band}`}
              >
                <span
                  className={`shrink-0 font-semibold ${glyph.color}`}
                  aria-hidden
                >
                  {glyph.char}
                </span>
                <span className="shrink-0 text-foreground">{e.label}</span>
                <span className="flex-1 text-muted-foreground">
                  — {e.action} · {e.streak} session{e.streak === 1 ? "" : "s"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Slice 20aa — proposal stability / sensitivity row inside the
 * ScorerProposalCard.
 *
 * Per actionable change, renders a row with the stability rating
 * badge (🟢/🟡/🔴), stability percentage, and — when the call
 * flipped under perturbation — the most common alternative action
 * so the manager can see which way the decision would drift.
 *
 * "Stability: 100% · flip on `Trade in hand`" reads as "rock solid."
 * "Stability: 40% · drop on `Edge` would drift to keep" reads as
 * "this one is a knife's-edge call — one more deal could flip it."
 * The row is the visual complement of the header pill: the pill
 * tells you the aggregate, the row tells you which specific pieces
 * earned it.
 */
function ScorerProposalStabilityRow({
  stability,
}: {
  stability: ProposalStabilityReport;
}) {
  const meanPct =
    stability.meanStability === null
      ? null
      : Math.round(stability.meanStability * 100);
  return (
    <div
      className="rounded border border-violet-500/15 bg-background/40 p-2"
      role="region"
      aria-label="Proposal stability under small perturbations"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
          Stability (sensitivity)
        </div>
        {meanPct !== null && (
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {meanPct}% mean
          </div>
        )}
      </div>
      {stability.headline && (
        <p className="mt-0.5 text-[11px] text-foreground">{stability.headline}</p>
      )}
      <ul className="mt-1.5 space-y-1">
        {stability.changes.map((row, i) => {
          const ratingTone =
            row.rating === "stable"
              ? { icon: "🟢", color: "text-emerald-300" }
              : row.rating === "mixed"
                ? { icon: "🟡", color: "text-amber-300" }
                : { icon: "🔴", color: "text-rose-300" };
          const pct = Math.round(row.stability * 100);
          const drift =
            row.altAction && row.altAction !== row.action
              ? `would drift to ${row.altAction}`
              : null;
          return (
            <li
              key={`${row.label}-${i}`}
              className="border-l border-violet-500/20 pl-2"
              aria-label={`${row.label}: ${row.action} is ${row.rating} at ${pct} percent stability${drift ? ` — ${drift}` : ""}`}
            >
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className={ratingTone.color}>{ratingTone.icon}</span>
                <span
                  className="font-mono text-foreground truncate"
                  title={row.label}
                >
                  {row.label}
                </span>
                <span className="text-muted-foreground">· {row.action}</span>
                <span className={`ml-auto tabular-nums ${ratingTone.color}`}>
                  {pct}%
                </span>
              </div>
              {drift && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  <span className="text-foreground">If perturbed:</span> {drift}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CallFlipBucket({
  label,
  flips,
  tone,
}: {
  label: string;
  flips: CallFlip[];
  tone: "emerald" | "rose";
}) {
  const labelColor = tone === "emerald" ? "text-emerald-400" : "text-rose-400";
  const rowColor = tone === "emerald" ? "text-emerald-300" : "text-rose-300";
  return (
    <div>
      <div className={`text-[10px] font-semibold ${labelColor}`}>{label}</div>
      <ul className="mt-0.5 space-y-0.5">
        {flips.map((f) => (
          <li
            key={f.packageId}
            className={`flex items-center gap-2 text-[10px] tabular-nums ${rowColor}`}
            aria-label={`Deal ${f.packageId} outcome ${f.outcome}: ${f.previous}% previous call ${f.previousCall}, ${f.proposed}% proposed call ${f.proposedCall}`}
          >
            <span className="font-mono truncate max-w-[8rem]" title={f.packageId}>
              {f.packageId}
            </span>
            <span className="flex-1 truncate text-muted-foreground">
              {formatFlipRow(f)}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
