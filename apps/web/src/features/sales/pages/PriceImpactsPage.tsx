import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  DollarSign,
  FileText,
  History,
  Loader2,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  applyRepriceDraft,
  createRepriceDraft,
  dismissRepriceImpact,
  fetchRepPriceImpacts,
  reverseRepriceApply,
  type RepPriceImpact,
  type RepPriceImpactLine,
  type RepRepriceAudit,
  type RepPriceImpactSummary,
} from "@/features/price-intelligence/lib/price-intelligence-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { REP_PRICE_IMPACTS_QUERY_KEY } from "@/lib/queryKeys";

const PRICE_IMPACTS_QUERY_KEY = REP_PRICE_IMPACTS_QUERY_KEY;

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
  const dollars = Math.abs(cents) / 100;
  return `${sign}$${dollars.toLocaleString(undefined, {
    maximumFractionDigits: dollars >= 1_000 ? 0 : 2,
  })}`;
}

function formatCurrencyCents(cents: number | null): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
  const dollars = Math.abs(cents) / 100;
  const formatted = `$${dollars.toLocaleString(undefined, {
    maximumFractionDigits: dollars >= 1_000 ? 0 : 2,
  })}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function quoteLabel(impact: RepPriceImpact): string {
  const compact = impact.quotePackageId
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase();
  return compact ? `Quote ${compact}` : "Quote";
}

function humanizeReason(reason: string): string {
  switch (reason) {
    case "manager_review_policy":
      return "OEM policy requires manager review";
    case "stock_lock":
      return "Yard-stock price lock";
    case "missing_margin_floor":
      return "Missing margin floor";
    case "missing_cost_basis":
      return "Missing cost basis";
    case "below_margin_floor":
      return "Below margin floor";
    default:
      return reason.replace(/_/g, " ");
  }
}

function statusLabel(impact: RepPriceImpact): string {
  switch (impact.state) {
    case "draft_created":
      return "Draft created";
    case "approval_pending":
      return "Approval pending";
    case "approved":
      return "Approved";
    case "applied":
      return "Applied · reversible audit";
    default:
      return impact.requiresManagerReview ? "Needs approval" : "Needs review";
  }
}

function groupByEvent(
  impacts: RepPriceImpact[],
): Array<[string, RepPriceImpact[]]> {
  const groups = new Map<string, RepPriceImpact[]>();
  for (const impact of impacts) {
    const key = impact.eventId || "current-event";
    groups.set(key, [...(groups.get(key) ?? []), impact]);
  }
  return [...groups.entries()].map(([eventId, rows]) => [
    eventId,
    rows.sort(
      (a, b) => Math.abs(b.totalDeltaCents) - Math.abs(a.totalDeltaCents),
    ),
  ]);
}

export function summarizeVisibleImpacts(
  impacts: RepPriceImpact[],
): RepPriceImpactSummary {
  const actionable = impacts.filter((impact) => impact.state !== "applied");
  return {
    visibleImpactCount: actionable.length,
    affectedQuoteCount: new Set(actionable.map((impact) => impact.quotePackageId)).size,
    totalDeltaCents: actionable.reduce((sum, impact) => sum + impact.totalDeltaCents, 0),
    needsApprovalCount: actionable.filter((impact) => impact.requiresManagerReview).length,
  };
}

export function PriceImpactsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [dismissTarget, setDismissTarget] = useState<RepPriceImpact | null>(
    null,
  );
  const [dismissReason, setDismissReason] = useState("");
  const [reverseTarget, setReverseTarget] = useState<{
    impact: RepPriceImpact;
    audit: RepRepriceAudit;
  } | null>(null);

  const impactsQuery = useQuery({
    queryKey: PRICE_IMPACTS_QUERY_KEY,
    queryFn: fetchRepPriceImpacts,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const focusedQuotePackageId =
    searchParams.get("quote_package_id")?.trim() || null;
  const visibleImpacts = useMemo(() => {
    const impacts = impactsQuery.data?.impacts ?? [];
    return focusedQuotePackageId
      ? impacts.filter(
          (impact) => impact.quotePackageId === focusedQuotePackageId,
        )
      : impacts;
  }, [focusedQuotePackageId, impactsQuery.data?.impacts]);
  const grouped = useMemo(() => groupByEvent(visibleImpacts), [visibleImpacts]);
  const focusedSummary = useMemo(
    () => summarizeVisibleImpacts(visibleImpacts),
    [visibleImpacts],
  );

  const createDraftMutation = useMutation({
    mutationFn: (impact: RepPriceImpact) => createRepriceDraft(impact.id),
    onSuccess: (result) => {
      toast({
        title: result.approvalRequired
          ? "Submitted for approval"
          : "Reprice draft created",
        description: result.approvalRequired
          ? "A manager must review this OEM-driven reprice before it can be applied."
          : "The draft is ready for rep review. No customer email was sent.",
      });
      void queryClient.invalidateQueries({ queryKey: PRICE_IMPACTS_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: "Couldn't create reprice draft",
        description:
          error instanceof Error
            ? error.message
            : "Try refreshing the price impacts.",
        variant: "destructive",
      });
    },
  });

  const applyDraftMutation = useMutation({
    mutationFn: (impact: RepPriceImpact) => {
      const draftId = impact.currentDraft?.id;
      if (!draftId || impact.currentDraft?.status !== "approved") {
        throw new Error(
          "The approved OEM re-price draft is not current. Refresh the queue.",
        );
      }
      return applyRepriceDraft(draftId);
    },
    onSuccess: (result) => {
      toast({
        title: result.idempotent
          ? "Re-price already applied"
          : "Approved re-price applied",
        description:
          "Quote lines, totals, version, and audit history were updated together. No customer communication was sent.",
      });
      void queryClient.invalidateQueries({ queryKey: PRICE_IMPACTS_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: "Couldn't apply the approved re-price",
        description:
          error instanceof Error
            ? error.message
            : "Refresh the quote and confirm the approval is still current.",
        variant: "destructive",
      });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: ({ impactId, reason }: { impactId: string; reason: string }) =>
      dismissRepriceImpact(impactId, reason),
    onSuccess: () => {
      toast({
        title: "Price impact dismissed",
        description:
          "This quote will no longer appear in your OEM impact queue.",
      });
      setDismissTarget(null);
      setDismissReason("");
      void queryClient.invalidateQueries({ queryKey: PRICE_IMPACTS_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: "Couldn't dismiss impact",
        description:
          error instanceof Error ? error.message : "Try again with a reason.",
        variant: "destructive",
      });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: (audit: RepRepriceAudit) => reverseRepriceApply(audit.id),
    onSuccess: (result) => {
      toast({
        title: result.idempotent
          ? "Re-price already reversed"
          : "OEM re-price reversed",
        description:
          "The audited quote prices and totals were restored together. No customer communication was sent.",
      });
      setReverseTarget(null);
      void queryClient.invalidateQueries({ queryKey: PRICE_IMPACTS_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: "Couldn't reverse the OEM re-price",
        description: error instanceof Error
          ? error.message
          : "Later quote work may make this apply ineligible for reversal.",
        variant: "destructive",
      });
    },
  });

  const summary = focusedQuotePackageId
    ? focusedSummary
    : impactsQuery.data?.summary;

  return (
    <div className="flex flex-col pb-20 max-w-2xl mx-auto">
      <div
        className="px-4 pt-3.5 pb-4 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/sales/today")}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to Sales Today"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Sales Today
        </button>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold text-qep-orange-accessible uppercase tracking-[0.13em]">
              OEM price impacts
            </p>
            <h1 className="text-[24px] font-black tracking-[-0.03em] text-foreground">
              Review re-prices
            </h1>
          </div>
          {summary && summary.visibleImpactCount > 0 && (
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Exposure
              </p>
              <p className="text-[17px] font-black tabular-nums text-qep-orange-accessible">
                {formatCents(summary.totalDeltaCents)}
              </p>
            </div>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
          Rep-visible queue for material assigned quote impacts only. Create
          drafts or submit approval; customers are never auto-sent OEM price
          updates from this page.
        </p>
        {focusedQuotePackageId ? (
          <p className="mt-2 text-[11px] font-semibold text-qep-orange-accessible">
            Focused on quote{" "}
            {focusedQuotePackageId.replace(/-/g, "").slice(0, 8).toUpperCase()}
          </p>
        ) : null}
      </div>

      <div className="px-4 py-4">
        {impactsQuery.isLoading ? (
          <PriceImpactSkeleton />
        ) : impactsQuery.isError ? (
          <ErrorState onRetry={() => void impactsQuery.refetch()} />
        ) : !summary ||
          visibleImpacts.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {summary.visibleImpactCount > 0 && (
              <SummaryStrip
                affectedQuotes={summary.affectedQuoteCount}
                impactCount={summary.visibleImpactCount}
                exposureCents={summary.totalDeltaCents}
                approvals={summary.needsApprovalCount}
              />
            )}

            <div className="mt-4 space-y-5">
              {grouped.map(([eventId, impacts]) => (
                <section key={eventId}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
                      Event{" "}
                      {eventId.replace(/-/g, "").slice(0, 8).toUpperCase()}
                    </span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                    <span className="text-[10px] text-muted-foreground">
                      {impacts.length}{" "}
                      {impacts.length === 1 ? "quote" : "quotes"}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {impacts.map((impact) => (
                      <ImpactCard
                        key={impact.id}
                        impact={impact}
                        onOpenQuote={() =>
                          navigate(`/sales/quotes/${impact.quotePackageId}`)
                        }
                        onDraft={() => createDraftMutation.mutate(impact)}
                        onApply={() => applyDraftMutation.mutate(impact)}
                        onDismiss={() => setDismissTarget(impact)}
                        onReverse={(audit) =>
                          setReverseTarget({ impact, audit })}
                        draftPending={
                          createDraftMutation.isPending &&
                          createDraftMutation.variables?.id === impact.id
                        }
                        applyPending={
                          applyDraftMutation.isPending &&
                          applyDraftMutation.variables?.id === impact.id
                        }
                        reversePending={
                          reverseMutation.isPending &&
                          (impact.history ?? []).some((audit) =>
                            audit.id === reverseMutation.variables?.id
                          )
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog
        open={dismissTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDismissTarget(null);
            setDismissReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dismiss OEM price impact?</DialogTitle>
            <DialogDescription>
              Add a reason so managers can audit why this material impact was
              not repriced.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Reason</span>
            <textarea
              value={dismissReason}
              onChange={(event) =>
                setDismissReason(event.target.value.slice(0, 500))
              }
              rows={3}
              className="w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
              placeholder="Example: customer already accepted current price."
            />
          </label>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDismissTarget(null);
                setDismissReason("");
              }}
              disabled={dismissMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!dismissTarget) return;
                dismissMutation.mutate({
                  impactId: dismissTarget.id,
                  reason: dismissReason.trim(),
                });
              }}
              disabled={
                dismissMutation.isPending || dismissReason.trim().length === 0
              }
            >
              {dismissMutation.isPending ? "Dismissing…" : "Dismiss impact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reverseTarget !== null}
        onOpenChange={(open) => {
          if (!open && !reverseMutation.isPending) setReverseTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse this OEM re-price?</DialogTitle>
            <DialogDescription>
              This restores only the selected apply audit. The server refuses
              reversal if the quote, source event, or repriced lines contain
              newer work.
            </DialogDescription>
          </DialogHeader>
          {reverseTarget && (
            <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-3 text-sm">
              <p className="font-bold text-foreground">
                {quoteLabel(reverseTarget.impact)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Applied version {reverseTarget.audit.afterVersionNumber ?? "—"}
                {reverseTarget.audit.reversalDeadline
                  ? ` · eligible through ${new Date(reverseTarget.audit.reversalDeadline).toLocaleString()}`
                  : ""}
              </p>
              <p className="mt-2 text-xs font-medium text-emerald-300">
                No customer email, PDF, or send action is created.
              </p>
            </div>
          )}
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReverseTarget(null)}
              disabled={reverseMutation.isPending}
            >
              Keep current prices
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (reverseTarget) reverseMutation.mutate(reverseTarget.audit);
              }}
              disabled={
                reverseMutation.isPending || !reverseTarget?.audit.canReverse
              }
            >
              {reverseMutation.isPending ? (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Confirm audited reversal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryStrip({
  affectedQuotes,
  impactCount,
  exposureCents,
  approvals,
}: {
  affectedQuotes: number;
  impactCount: number;
  exposureCents: number;
  approvals: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <SummaryMetric
        label="Quotes"
        value={String(affectedQuotes || impactCount)}
      />
      <SummaryMetric label="Exposure" value={formatCents(exposureCents)} />
      <SummaryMetric label="Approval" value={String(approvals)} />
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[hsl(var(--card))] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-[15px] font-black tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function ImpactCard({
  impact,
  onOpenQuote,
  onDraft,
  onApply,
  onDismiss,
  onReverse,
  draftPending,
  applyPending,
  reversePending,
}: {
  impact: RepPriceImpact;
  onOpenQuote: () => void;
  onDraft: () => void;
  onApply: () => void;
  onDismiss: () => void;
  onReverse: (audit: RepRepriceAudit) => void;
  draftPending: boolean;
  applyPending: boolean;
  reversePending: boolean;
}) {
  const canCreateDraft = impact.state === "visible";
  const canApply =
    impact.state === "approved" && impact.currentDraft?.status === "approved";
  const actionPending = draftPending || applyPending || reversePending;
  const history = impact.history ?? [];
  const reversibleAudit = history.find((audit) => audit.canReverse) ?? null;
  const primaryLabel = canApply
    ? "Apply approved re-price"
    : impact.state === "approval_pending"
      ? "Awaiting manager approval"
      : impact.state === "approved"
        ? "Approved draft unavailable"
        : impact.state === "applied"
          ? "Re-price applied"
        : impact.requiresManagerReview
          ? "Submit approval"
          : "Create draft";
  return (
    <article className="rounded-3xl border border-white/[0.08] bg-[hsl(var(--card))] p-4 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-black text-foreground truncate">
            {quoteLabel(impact)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {impact.quoteStatus ?? "open quote"} · {impact.lines.length}{" "}
            impacted {impact.lines.length === 1 ? "line" : "lines"}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-qep-orange/30 bg-qep-orange/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-qep-orange-accessible">
          {statusLabel(impact)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniMetric
          label="Delta"
          value={formatCents(impact.totalDeltaCents)}
          tone="orange"
        />
        <MiniMetric
          label="Margin"
          value={`${formatPercent(impact.oldMarginPct)} → ${formatPercent(impact.projectedMarginPct)}`}
        />
      </div>

      <CommissionProjection impact={impact} />

      {impact.requiresManagerReview && (
        <div className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
          <div className="flex items-start gap-2">
            <ShieldAlert
              className="w-4 h-4 mt-0.5 text-amber-300 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="text-[12px] font-bold text-amber-200">
                Manager review required
              </p>
              <p className="text-[11px] text-amber-100/75 leading-snug">
                {impact.approvalRequiredReasons
                  .map(humanizeReason)
                  .join(" · ") || "Approval policy"}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
        {impact.lines.slice(0, 4).map((line) => (
          <ImpactLineRow key={line.id} line={line} />
        ))}
        {impact.lines.length > 4 && (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">
            +{impact.lines.length - 4} more impacted lines
          </p>
        )}
      </div>

      {history.length > 0 && (
        <section
          aria-label="OEM re-price audit history"
          className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              Audit history
            </p>
            <span className="text-[10px] text-emerald-300">
              No customer send
            </span>
          </div>
          <div className="mt-2 space-y-1.5">
            {history.slice(0, 4).map((audit) => (
              <div
                key={audit.id}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="font-medium text-foreground">
                  {audit.action === "apply"
                    ? "Applied OEM re-price"
                    : "Reversed OEM re-price"}
                </span>
                <span className="text-right tabular-nums text-muted-foreground">
                  v{audit.beforeVersionNumber ?? "—"} → v
                  {audit.afterVersionNumber ?? "—"}
                </span>
              </div>
            ))}
          </div>
          {reversibleAudit && (
            <button
              type="button"
              onClick={() => onReverse(reversibleAudit)}
              disabled={actionPending}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-400/[0.07] px-4 text-sm font-bold text-rose-200 disabled:opacity-50"
            >
              {reversePending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              )}
              Reverse audited apply
            </button>
          )}
        </section>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <button
          type="button"
          onClick={canApply ? onApply : onDraft}
          disabled={(!canCreateDraft && !canApply) || actionPending}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-qep-orange-accessible px-4 py-2.5 text-sm font-black text-white transition-transform active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {actionPending && (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          )}
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={onOpenQuote}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/[0.09] bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-foreground hover:bg-white/[0.07]"
        >
          <FileText className="w-4 h-4" aria-hidden="true" />
          Open quote
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={!canCreateDraft}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/[0.09] bg-white/[0.02] px-4 py-2.5 text-sm font-bold text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
        >
          <XCircle className="w-4 h-4" aria-hidden="true" />
          Dismiss
        </button>
      </div>
    </article>
  );
}

function CommissionProjection({ impact }: { impact: RepPriceImpact }) {
  return (
    <section
      aria-label="Projected OEM-DP10 commission change"
      className="mt-2 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-1.5">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
          Projected OEM-DP10 commission
        </p>
        <p className="text-[10px] text-muted-foreground">
          Projection only · not final commission-ledger truth
        </p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <MiniMetric
          label="Old"
          value={formatCurrencyCents(impact.oldCommissionCents)}
        />
        <MiniMetric
          label="New"
          value={formatCurrencyCents(impact.projectedCommissionCents)}
        />
        <MiniMetric
          label="Delta"
          value={formatCents(impact.commissionDeltaCents)}
          tone="orange"
        />
      </div>
    </section>
  );
}

function MiniMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "orange";
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-0.5 text-[12px] font-black tabular-nums ${tone === "orange" ? "text-qep-orange-accessible" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

function ImpactLineRow({ line }: { line: RepPriceImpactLine }) {
  return (
    <div className="px-3 py-2.5 flex items-center gap-3">
      <DollarSign
        className="w-3.5 h-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-bold text-foreground truncate">
          {line.make ? `${line.make} ` : ""}
          {line.modelCode}
          {line.quantity > 1 ? ` × ${line.quantity}` : ""}
        </p>
        <p className="text-[10.5px] text-muted-foreground">
          {formatCents(line.oldListPriceCents)} →{" "}
          {formatCents(line.newListPriceCents)}
          {line.suppressedByStockLock ? " · stock locked" : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[12px] font-black text-foreground tabular-nums">
          {formatCents(line.deltaCents)}
        </p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {formatPercent(line.deltaPct)}
        </p>
      </div>
    </div>
  );
}

function PriceImpactSkeleton() {
  return (
    <div
      className="space-y-3 animate-pulse"
      role="status"
      aria-label="Loading price impacts"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="rounded-3xl border border-white/[0.06] bg-white/[0.03] p-4"
        >
          <div className="h-4 w-1/2 rounded bg-white/[0.08]" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="h-12 rounded-2xl bg-white/[0.05]" />
            <div className="h-12 rounded-2xl bg-white/[0.05]" />
            <div className="h-12 rounded-2xl bg-white/[0.05]" />
          </div>
          <div className="mt-3 h-20 rounded-2xl bg-white/[0.04]" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-3xl border border-red-500/20 bg-red-500/[0.06] px-5 py-6 text-center">
      <p className="text-sm font-bold text-red-200">
        OEM impacts could not load.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Refresh the queue and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-2xl bg-white/[0.08] px-4 text-sm font-bold text-foreground"
      >
        Retry
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-white/[0.07] bg-[hsl(var(--card))] px-5 py-8 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300">
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="text-base font-black text-foreground">
        No material OEM impacts
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Assigned reps only see material quote impacts after an OEM price feed is
        published.
      </p>
    </div>
  );
}
