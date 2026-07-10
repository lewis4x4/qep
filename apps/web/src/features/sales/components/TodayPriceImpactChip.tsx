import { ArrowRight, FileWarning, RefreshCw } from "lucide-react";
import type { RepPriceImpactSummary } from "@/features/price-intelligence/lib/price-intelligence-api";
import { formatCentsCompact } from "./OemPriceImpactCard";

export function TodayPriceImpactChip({
  summary,
  onReview,
}: {
  summary: RepPriceImpactSummary;
  onReview: () => void;
}) {
  if (summary.visibleImpactCount <= 0) return null;

  const quoteLabel = summary.affectedQuoteCount === 1 ? "quote" : "quotes";
  return (
    <button
      type="button"
      onClick={onReview}
      aria-label={`Review ${summary.affectedQuoteCount} ${quoteLabel} affected by an OEM price update`}
      className="group flex min-h-12 w-full items-center gap-3 rounded-2xl border border-qep-orange/30 bg-qep-orange/[0.09] px-3.5 py-2.5 text-left shadow-[0_8px_24px_rgba(232,119,34,0.08)] transition-colors hover:bg-qep-orange/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange-accessible focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-qep-orange/25 bg-qep-orange/15 text-qep-orange-accessible">
        <FileWarning className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-extrabold uppercase tracking-[0.12em] text-qep-orange-accessible">
          OEM price impact
        </span>
        <span className="block truncate text-sm font-black text-foreground">
          {summary.affectedQuoteCount} {quoteLabel} · {formatCentsCompact(summary.totalDeltaCents)} exposure
        </span>
        <span className="block text-[11px] text-muted-foreground">
          Review before send · never auto-sent
        </span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-qep-orange-accessible transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}

export function TodayPriceImpactChipLoading() {
  return (
    <div
      role="status"
      aria-label="Checking OEM price impacts"
      className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5"
    >
      <span className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-white/[0.06] motion-reduce:animate-none" />
      <span className="min-w-0 flex-1 space-y-1.5" aria-hidden="true">
        <span className="block h-2 w-24 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" />
        <span className="block h-3 w-48 max-w-full animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" />
      </span>
      <span className="sr-only">Checking OEM price impacts…</span>
    </div>
  );
}

export function TodayPriceImpactChipError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-12 items-center gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.05] px-3.5 py-2.5"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-red-200">
          OEM price impacts could not load
        </span>
        <span className="block text-[11px] text-muted-foreground">
          Your Today feed is still available.
        </span>
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-foreground hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange-accessible"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}
