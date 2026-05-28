import { ArrowRight, BadgeDollarSign, FileWarning, ShieldAlert } from "lucide-react";
import type {
  RepPriceImpact,
  RepPriceImpactSummary,
} from "@/features/price-intelligence/lib/price-intelligence-api";

export interface OemPriceImpactCardProps {
  summary: RepPriceImpactSummary;
  impacts: RepPriceImpact[];
  onReview: () => void;
}

export function formatCentsCompact(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
  if (dollars >= 1_000_000) return `${sign}$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `${sign}$${(dollars / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(dollars).toLocaleString()}`;
}

function quoteLabel(impact: RepPriceImpact): string {
  const compact = impact.quotePackageId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return compact ? `Quote ${compact}` : "Quote";
}

export function topPriceImpacts(impacts: RepPriceImpact[], limit = 3): RepPriceImpact[] {
  return impacts
    .slice()
    .sort((a, b) => Math.abs(b.totalDeltaCents) - Math.abs(a.totalDeltaCents))
    .slice(0, limit);
}

export function OemPriceImpactCard({
  summary,
  impacts,
  onReview,
}: OemPriceImpactCardProps) {
  if (summary.visibleImpactCount <= 0 || impacts.length === 0) return null;

  const topImpacts = topPriceImpacts(impacts);
  const exposure = formatCentsCompact(summary.totalDeltaCents);

  return (
    <section
      aria-label="OEM price impacts"
      className="rounded-3xl border border-qep-orange/35 bg-gradient-to-br from-qep-orange/[0.16] via-qep-orange/[0.08] to-white/[0.03] p-4 shadow-[0_14px_40px_rgba(232,119,34,0.12)]"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-qep-orange/20 border border-qep-orange/30 flex items-center justify-center shrink-0">
          <FileWarning className="w-5 h-5 text-qep-orange" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-qep-orange/90">
            OEM price update
          </p>
          <h2 className="mt-1 text-[18px] font-black leading-tight text-foreground tracking-[-0.02em]">
            {summary.visibleImpactCount} {summary.visibleImpactCount === 1 ? "quote" : "quotes"} affected · {exposure} exposure
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground leading-snug">
            Review material quote impacts before any customer communication. No emails are sent automatically.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {topImpacts.map((impact) => (
          <div
            key={impact.id}
            className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-black/[0.12] px-3 py-2.5"
          >
            <BadgeDollarSign className="w-4 h-4 text-emerald-300/90 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-foreground truncate">
                {quoteLabel(impact)}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {impact.lines.slice(0, 2).map((line) => line.modelCode).join(", ") || "Impacted equipment"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[13px] font-extrabold tabular-nums text-foreground">
                {formatCentsCompact(impact.totalDeltaCents)}
              </p>
              {impact.requiresManagerReview && (
                <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                  <ShieldAlert className="w-3 h-3" aria-hidden="true" />
                  approval
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onReview}
        className="mt-3 w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-qep-orange px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-qep-orange/20 transition-transform active:scale-[0.985]"
      >
        Review re-prices
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </section>
  );
}
