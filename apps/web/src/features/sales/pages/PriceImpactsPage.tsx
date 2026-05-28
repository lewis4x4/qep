import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  DollarSign,
  FileText,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  createRepriceDraft,
  dismissRepriceImpact,
  fetchRepPriceImpacts,
  type RepPriceImpact,
  type RepPriceImpactLine,
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

function formatPercent(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function quoteLabel(impact: RepPriceImpact): string {
  const compact = impact.quotePackageId.replace(/-/g, "").slice(0, 8).toUpperCase();
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
    default:
      return impact.requiresManagerReview ? "Needs approval" : "Needs review";
  }
}

function groupByEvent(impacts: RepPriceImpact[]): Array<[string, RepPriceImpact[]]> {
  const groups = new Map<string, RepPriceImpact[]>();
  for (const impact of impacts) {
    const key = impact.eventId || "current-event";
    groups.set(key, [...(groups.get(key) ?? []), impact]);
  }
  return [...groups.entries()].map(([eventId, rows]) => [
    eventId,
    rows.sort((a, b) => Math.abs(b.totalDeltaCents) - Math.abs(a.totalDeltaCents)),
  ]);
}

export function PriceImpactsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dismissTarget, setDismissTarget] = useState<RepPriceImpact | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  const impactsQuery = useQuery({
    queryKey: PRICE_IMPACTS_QUERY_KEY,
    queryFn: fetchRepPriceImpacts,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const grouped = useMemo(
    () => groupByEvent(impactsQuery.data?.impacts ?? []),
    [impactsQuery.data?.impacts],
  );

  const createDraftMutation = useMutation({
    mutationFn: (impact: RepPriceImpact) => createRepriceDraft(impact.id),
    onSuccess: (result) => {
      toast({
        title: result.approvalRequired ? "Submitted for approval" : "Reprice draft created",
        description: result.approvalRequired
          ? "A manager must review this OEM-driven reprice before it can be applied."
          : "The draft is ready for rep review. No customer email was sent.",
      });
      void queryClient.invalidateQueries({ queryKey: PRICE_IMPACTS_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: "Couldn't create reprice draft",
        description: error instanceof Error ? error.message : "Try refreshing the price impacts.",
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
        description: "This quote will no longer appear in your OEM impact queue.",
      });
      setDismissTarget(null);
      setDismissReason("");
      void queryClient.invalidateQueries({ queryKey: PRICE_IMPACTS_QUERY_KEY });
    },
    onError: (error) => {
      toast({
        title: "Couldn't dismiss impact",
        description: error instanceof Error ? error.message : "Try again with a reason.",
        variant: "destructive",
      });
    },
  });

  const summary = impactsQuery.data?.summary;

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
            <p className="text-[10px] font-extrabold text-qep-orange uppercase tracking-[0.13em]">
              OEM price impacts
            </p>
            <h1 className="text-[24px] font-black tracking-[-0.03em] text-foreground">
              Review re-prices
            </h1>
          </div>
          {summary && summary.visibleImpactCount > 0 && (
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/60">
                Exposure
              </p>
              <p className="text-[17px] font-black tabular-nums text-qep-orange">
                {formatCents(summary.totalDeltaCents)}
              </p>
            </div>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
          Rep-visible queue for material assigned quote impacts only. Create drafts or submit approval; customers are never auto-sent OEM price updates from this page.
        </p>
      </div>

      <div className="px-4 py-4">
        {impactsQuery.isLoading ? (
          <PriceImpactSkeleton />
        ) : impactsQuery.isError ? (
          <ErrorState onRetry={() => void impactsQuery.refetch()} />
        ) : !summary || summary.visibleImpactCount === 0 ? (
          <EmptyState />
        ) : (
          <>
            <SummaryStrip
              affectedQuotes={summary.affectedQuoteCount}
              impactCount={summary.visibleImpactCount}
              exposureCents={summary.totalDeltaCents}
              approvals={summary.needsApprovalCount}
            />

            <div className="mt-4 space-y-5">
              {grouped.map(([eventId, impacts]) => (
                <section key={eventId}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
                      Event {eventId.replace(/-/g, "").slice(0, 8).toUpperCase()}
                    </span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                    <span className="text-[10px] text-muted-foreground/70">
                      {impacts.length} {impacts.length === 1 ? "quote" : "quotes"}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {impacts.map((impact) => (
                      <ImpactCard
                        key={impact.id}
                        impact={impact}
                        onOpenQuote={() => navigate(`/sales/quotes/${impact.quotePackageId}`)}
                        onDraft={() => createDraftMutation.mutate(impact)}
                        onDismiss={() => setDismissTarget(impact)}
                        draftPending={
                          createDraftMutation.isPending &&
                          createDraftMutation.variables?.id === impact.id
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
              Add a reason so managers can audit why this material impact was not repriced.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Reason</span>
            <textarea
              value={dismissReason}
              onChange={(event) => setDismissReason(event.target.value.slice(0, 500))}
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
              disabled={dismissMutation.isPending || dismissReason.trim().length === 0}
            >
              {dismissMutation.isPending ? "Dismissing…" : "Dismiss impact"}
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
      <SummaryMetric label="Quotes" value={String(affectedQuotes || impactCount)} />
      <SummaryMetric label="Exposure" value={formatCents(exposureCents)} />
      <SummaryMetric label="Approval" value={String(approvals)} />
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[hsl(var(--card))] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60">
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
  onDismiss,
  draftPending,
}: {
  impact: RepPriceImpact;
  onOpenQuote: () => void;
  onDraft: () => void;
  onDismiss: () => void;
  draftPending: boolean;
}) {
  const canCreateDraft = impact.state === "visible";
  return (
    <article className="rounded-3xl border border-white/[0.08] bg-[hsl(var(--card))] p-4 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-black text-foreground truncate">
            {quoteLabel(impact)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {impact.quoteStatus ?? "open quote"} · {impact.lines.length} impacted {impact.lines.length === 1 ? "line" : "lines"}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-qep-orange/30 bg-qep-orange/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-qep-orange">
          {statusLabel(impact)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <MiniMetric label="Delta" value={formatCents(impact.totalDeltaCents)} tone="orange" />
        <MiniMetric label="Margin" value={`${formatPercent(impact.oldMarginPct)} → ${formatPercent(impact.projectedMarginPct)}`} />
        <MiniMetric label="Commission" value={formatCents(impact.commissionDeltaCents)} />
      </div>

      {impact.requiresManagerReview && (
        <div className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-[12px] font-bold text-amber-200">
                Manager review required
              </p>
              <p className="text-[11px] text-amber-100/75 leading-snug">
                {impact.approvalRequiredReasons.map(humanizeReason).join(" · ") || "Approval policy"}
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

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <button
          type="button"
          onClick={onDraft}
          disabled={!canCreateDraft || draftPending}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-qep-orange px-4 py-2.5 text-sm font-black text-white transition-transform active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {draftPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {impact.requiresManagerReview ? "Submit approval" : "Create draft"}
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
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60">
        {label}
      </p>
      <p className={`mt-0.5 text-[12px] font-black tabular-nums ${tone === "orange" ? "text-qep-orange" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function ImpactLineRow({ line }: { line: RepPriceImpactLine }) {
  return (
    <div className="px-3 py-2.5 flex items-center gap-3">
      <DollarSign className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-bold text-foreground truncate">
          {line.make ? `${line.make} ` : ""}{line.modelCode}
          {line.quantity > 1 ? ` × ${line.quantity}` : ""}
        </p>
        <p className="text-[10.5px] text-muted-foreground">
          {formatCents(line.oldListPriceCents)} → {formatCents(line.newListPriceCents)}
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
    <div className="space-y-3 animate-pulse" role="status" aria-label="Loading price impacts">
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-3xl border border-white/[0.06] bg-white/[0.03] p-4">
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
      <p className="text-sm font-bold text-red-200">OEM impacts could not load.</p>
      <p className="mt-1 text-xs text-muted-foreground">Refresh the queue and try again.</p>
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
      <p className="text-base font-black text-foreground">No material OEM impacts</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Assigned reps only see material quote impacts after an OEM price feed is published.
      </p>
    </div>
  );
}
