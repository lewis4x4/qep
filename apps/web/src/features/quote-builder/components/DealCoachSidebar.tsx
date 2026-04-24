import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import {
  evaluateCoachRules,
  type DealCoachContext,
  type RuleResult,
} from "../lib/coach-rules";
import {
  getMarginBaseline,
  getActiveProgramsForDraft,
  getDismissedRuleIds,
  recordCoachAction,
  SEVERITY_TONE,
  type MarginBaseline,
} from "../lib/coach-api";
import {
  buildSimilarDealsQuery,
  getSimilarDealOutcomes,
  getReasonIntelligence,
  getPersonalSuppressions,
  getRuleAcceptanceStats,
  type SimilarDealsResult,
  type ReasonIntelligence,
  type RuleAcceptanceStat,
} from "../lib/deal-intelligence-api";
import type { AcceptanceSnapshot } from "../lib/coach-rules/adaptive";
import { hasQuoteCustomerIdentity } from "../lib/quote-workspace";

/**
 * Slice 13 — Deal Coach Sidebar v1.
 *
 * Live intelligence during quote build. Runs the rule registry over a
 * debounced snapshot of the draft + fetched context (margin baseline,
 * active programs, prior dismissals). Top 3 results shown, sorted by
 * severity.
 *
 * Collapsible (desktop right-rail or mobile top-collapse). Per-quote
 * dismissal memory persists to qb_deal_coach_actions so a rep doesn't
 * see the same suggestion on the same quote twice.
 */

export interface DealCoachSidebarProps {
  draft: QuoteWorkspaceDraft;
  computed: {
    equipmentTotal: number;
    attachmentTotal: number;
    subtotal: number;
    netTotal: number;
    marginAmount: number;
    marginPct: number;
  };
  /** The saved quote id, if the draft has been saved at least once.
   *  Actions (apply/dismiss) require this for persistence. */
  quotePackageId: string | null;
  /** Optional handler for rule actions that scroll/focus specific fields. */
  onAction?: (actionId: string) => void;
}

const DEBOUNCE_MS = 300;

/**
 * When writing coach actions to qb_deal_coach_actions we persist the
 * author-chosen severity, not the adaptively-demoted one — analytics
 * queries treat the severity column as "what tier did the rule author
 * think this deserved". The fact of demotion is already captured in
 * suggestion_snapshot.metrics.adaptive_demoted_from, so both are
 * recoverable.
 */
function persistableRule(rule: RuleResult): RuleResult {
  const originalSeverity = rule.metrics?.adaptive_demoted_from;
  if (originalSeverity === "critical" || originalSeverity === "warning" || originalSeverity === "info") {
    return { ...rule, severity: originalSeverity };
  }
  return rule;
}

export function DealCoachSidebar({
  draft,
  computed,
  quotePackageId,
  onAction,
}: DealCoachSidebarProps) {
  const { profile } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<RuleResult[]>([]);
  const [expandedWhy, setExpandedWhy] = useState<string | null>(null);

  const [marginBaseline, setMarginBaseline] = useState<MarginBaseline | null>(null);
  const [activePrograms, setActivePrograms] = useState<DealCoachContext["activePrograms"]>([]);
  const [dismissedRuleIds, setDismissedRuleIds] = useState<Set<string>>(new Set());

  // Slice 17 — intelligence layer state
  const [similarDeals, setSimilarDeals] = useState<SimilarDealsResult | null>(null);
  const [reasonIntelligence, setReasonIntelligence] = useState<ReasonIntelligence>({ stats: [], totalSamples: 0 });
  const [personalSuppressions, setPersonalSuppressions] = useState<Set<string>>(new Set());

  // Slice 18 — workspace acceptance snapshots drive adaptive demote/suppress
  const [acceptanceStats, setAcceptanceStats] = useState<AcceptanceSnapshot[]>([]);
  const coachReady = hasQuoteCustomerIdentity(draft) && draft.equipment.length > 0;

  // ── Context fetch (once per user + equipment-make change) ──────────────
  const equipmentMakesKey = useMemo(
    () => draft.equipment.map((e) => (e.make ?? "").trim()).join("|"),
    [draft.equipment],
  );

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    (async () => {
      const [baseline, programs, reasons, suppressions, acceptance] = await Promise.all([
        getMarginBaseline(profile.id),
        getActiveProgramsForDraft(draft),
        getReasonIntelligence(),
        getPersonalSuppressions({ repId: profile.id }),
        getRuleAcceptanceStats(),
      ]);
      if (cancelled) return;
      setMarginBaseline(baseline);
      setActivePrograms(programs);
      setReasonIntelligence(reasons);
      setPersonalSuppressions(suppressions);
      // The adaptive filter only needs the three fields — strip the rest
      // so we're not holding more than necessary in component state.
      setAcceptanceStats(acceptance.map((a: RuleAcceptanceStat): AcceptanceSnapshot => ({
        ruleId:            a.ruleId,
        timesShown:        a.timesShown,
        acceptanceRatePct: a.acceptanceRatePct,
      })));
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, equipmentMakesKey]);

  // Similar-deals query depends on brand + netTotal. Refetches when either
  // meaningfully changes — debounced at the netTotal level via rounding to
  // the nearest 1k, so minor tweaks don't trigger a re-query.
  const similarQueryKey = useMemo(() => {
    const query = buildSimilarDealsQuery(draft, computed.netTotal);
    if (!query) return "";
    return `${query.brandName ?? ""}::${Math.round(query.netTotal / 1000)}`;
  }, [equipmentMakesKey, computed.netTotal, draft]);

  useEffect(() => {
    if (!similarQueryKey) { setSimilarDeals(null); return; }
    let cancelled = false;
    const query = buildSimilarDealsQuery(draft, computed.netTotal);
    if (!query) { setSimilarDeals(null); return; }
    getSimilarDealOutcomes(query).then((result) => {
      if (!cancelled) setSimilarDeals(result);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarQueryKey]);

  // ── Dismissed-set fetch when quote id shows up ─────────────────────────
  useEffect(() => {
    if (!quotePackageId) {
      setDismissedRuleIds(new Set());
      return;
    }
    let cancelled = false;
    getDismissedRuleIds(quotePackageId).then((set) => {
      if (!cancelled) setDismissedRuleIds(set);
    });
    return () => { cancelled = true; };
  }, [quotePackageId]);

  // ── Debounced re-eval on context change ─────────────────────────────────
  const ctxSignature = useMemo(() => ({
    marginPct: computed.marginPct,
    equipmentMakesKey,
    marginBaseline,
    activeProgramCount: activePrograms.length,
    dismissedCount: dismissedRuleIds.size,
    hasRecommendation: !!draft.recommendation,
    // Slice 17 — include intelligence signals in the debounce key
    similarKey: similarDeals
      ? `${similarDeals.closedSampleSize}:${similarDeals.winRatePct}:${similarDeals.avgWinMarginPct}`
      : "",
    reasonKey: reasonIntelligence.totalSamples,
    suppressionKey: personalSuppressions.size,
    acceptanceKey: acceptanceStats.length,
  // similarDeals must stay in deps — its closure reference is what
  // React uses to decide when to recompute similarKey. Upstream
  // setSimilarDeals only fires when a query result arrives, so this
  // doesn't thrash.
  }), [
    computed.marginPct, equipmentMakesKey, marginBaseline,
    activePrograms.length, dismissedRuleIds.size, draft.recommendation,
    similarDeals, reasonIntelligence.totalSamples, personalSuppressions.size,
    acceptanceStats.length,
  ]);

  useEffect(() => {
    if (!coachReady) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (!profile || !marginBaseline) {
      setLoading(marginBaseline === null);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const ctx: DealCoachContext = {
        draft,
        computed,
        userId: profile.id,
        userRole: profile.role ?? null,
        quotePackageId,
        marginBaseline,
        activePrograms,
        similarDeals,
        reasonIntelligence,
      };
      // Combine per-quote dismissals with the rep's personal 30-day
      // suppression memory. Both silence the rule before it ever shows.
      const effectiveDismissals = new Set<string>([
        ...dismissedRuleIds,
        ...personalSuppressions,
      ]);
      const results = evaluateCoachRules(ctx, effectiveDismissals, acceptanceStats);
      setSuggestions(results);
      setLoading(false);
      // Record "shown" for each newly-surfaced suggestion (fire-and-forget).
      // Persistence restores the author-chosen severity — the adaptive
      // demote fact lives in `suggestion_snapshot.metrics` so analytics
      // can still see both, but `qb_deal_coach_actions.severity` keeps
      // its semantic meaning ("critical" = the author said so).
      if (quotePackageId && profile.active_workspace_id) {
        for (const r of results) {
          void recordCoachAction({
            workspaceId:  profile.active_workspace_id,
            quotePackageId,
            rule:         persistableRule(r),
            action:       "shown",
            showingUserId: profile.id,
          });
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxSignature, coachReady]);

  const handleApply = useCallback((rule: RuleResult) => {
    if (rule.action && onAction) onAction(rule.action.actionId);
    if (quotePackageId && profile?.active_workspace_id) {
      void recordCoachAction({
        workspaceId: profile.active_workspace_id,
        quotePackageId,
        rule: persistableRule(rule),
        action: "applied",
        showingUserId: profile.id,
      });
    }
  }, [onAction, quotePackageId, profile]);

  const handleDismiss = useCallback((rule: RuleResult) => {
    setSuggestions((prev) => prev.filter((s) => s.ruleId !== rule.ruleId));
    setDismissedRuleIds((prev) => {
      const next = new Set(prev);
      next.add(rule.ruleId);
      return next;
    });
    if (quotePackageId && profile?.active_workspace_id) {
      void recordCoachAction({
        workspaceId: profile.active_workspace_id,
        quotePackageId,
        rule: persistableRule(rule),
        action: "dismissed",
        showingUserId: profile.id,
      });
    }
  }, [quotePackageId, profile]);

  // ── Render ──────────────────────────────────────────────────────────────

  const headerCount = suggestions.length;
  const hasAny = coachReady && headerCount > 0;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium">Deal Coach</span>
          {loading && coachReady && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {!loading && hasAny && (
            <Badge variant="outline" className="text-[10px]">
              {headerCount} suggestion{headerCount === 1 ? "" : "s"}
            </Badge>
          )}
          {!coachReady && (
            <span className="text-xs text-muted-foreground">waiting</span>
          )}
          {!loading && coachReady && !hasAny && (
            <span className="text-xs text-muted-foreground">all clear</span>
          )}
        </span>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="space-y-2">
          {loading && coachReady && (
            <Card className="border-dashed">
              <CardContent className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Analyzing…
              </CardContent>
            </Card>
          )}

          {!coachReady && (
            <Card className="border-dashed">
              <CardContent className="p-3 text-xs text-muted-foreground">
                Waiting for quote details to review.
              </CardContent>
            </Card>
          )}

          {!loading && coachReady && !hasAny && (
            <Card className="border-dashed">
              <CardContent className="p-3 text-xs text-muted-foreground">
                No suggestions right now. Margin looks healthy and no active programs are being missed.
              </CardContent>
            </Card>
          )}

          {!loading && coachReady && suggestions.map((rule) => {
            const tone = SEVERITY_TONE[rule.severity];
            const whyExpanded = expandedWhy === rule.ruleId;
            return (
              <Card
                key={rule.ruleId}
                className={`border ${tone.border} ${tone.bg}`}
              >
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold">{rule.title}</div>
                    <Badge variant={tone.badge} className="text-[10px] capitalize shrink-0">
                      {rule.severity}
                    </Badge>
                  </div>

                  <p className="text-xs leading-relaxed text-foreground/90">
                    <FormattedBody text={rule.body} />
                  </p>

                  <button
                    type="button"
                    onClick={() => setExpandedWhy(whyExpanded ? null : rule.ruleId)}
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {whyExpanded ? "Hide reasoning" : "Why am I seeing this?"}
                  </button>

                  {whyExpanded && (
                    <p className="rounded-sm border-l-2 border-muted-foreground/30 bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                      {rule.why}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleDismiss(rule)}
                    >
                      Dismiss
                    </Button>
                    {rule.action && (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleApply(rule)}
                      >
                        {rule.action.label}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Parses **bold** spans inside rule body text. Nothing else. */
function FormattedBody({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
