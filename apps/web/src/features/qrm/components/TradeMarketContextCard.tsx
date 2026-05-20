import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TradeMarketContext } from "../lib/trade-market-context";

export interface TradeMarketContextCardProps {
  context: TradeMarketContext | null;
  loading?: boolean;
  variant?: "compact" | "detail";
  title?: string;
  href?: string | null;
  className?: string;
}

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function basisLabel(basis: TradeMarketContext["creditBasis"]["basis"]): string {
  switch (basis) {
    case "final":
      return "Final appraisal";
    case "preliminary":
      return "Preliminary desk value";
    case "comps_midpoint":
      return "Comp midpoint";
    default:
      return "No credit basis";
  }
}

export function TradeMarketContextCard({
  context,
  loading = false,
  variant = "compact",
  title = "Trade market context",
  href,
  className = "",
}: TradeMarketContextCardProps) {
  const visibleSources = context?.sources.filter((source) => !source.isAggregate) ?? [];
  const sourceLimit = variant === "compact" ? 3 : visibleSources.length;
  const sourcesToShow = visibleSources.slice(0, sourceLimit);

  return (
    <Card className={`border-qep-orange/20 bg-qep-orange/5 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-orange">{title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-qep-orange/30 text-[10px] text-qep-orange">
              Rep-facing only
            </Badge>
            <span className="text-[11px] text-muted-foreground">Do not include in customer copy</span>
          </div>
        </div>
        {href && (
          <Button asChild size="sm" variant="outline" className="h-8 shrink-0 text-xs">
            <Link to={href}>Open trade</Link>
          </Button>
        )}
      </div>

      {loading ? (
        <div className="mt-4 space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      ) : !context ? (
        <p className="mt-4 text-sm text-muted-foreground">No trade valuation is linked to this workspace yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{context.equipmentLabel}</p>
            {context.range ? (
              <p className="mt-1 text-lg font-bold text-qep-orange">
                {formatCurrency(context.range.low)} – {formatCurrency(context.range.high)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{context.noRangeReason}</p>
            )}
          </div>

          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-md border border-border/70 bg-background/60 p-2">
              <p className="text-muted-foreground">Applied value</p>
              <p className="mt-0.5 font-semibold text-foreground">{formatCurrency(context.appliedValue)}</p>
              {context.creditBasis.basis !== "none" && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{basisLabel(context.creditBasis.basis)}</p>
              )}
            </div>
            <div className="rounded-md border border-border/70 bg-background/60 p-2">
              <p className="text-muted-foreground">Confidence</p>
              <p className="mt-0.5 font-semibold capitalize text-foreground">{context.confidence ?? "Not scored"}</p>
              {context.isSynthetic && (
                <p className="mt-0.5 text-[11px] text-amber-300">Modeled until live feeds connect</p>
              )}
            </div>
          </div>

          {context.creditBasis.line && (
            <p className="rounded-md border-l-2 border-qep-orange/50 bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
              {context.creditBasis.line}
            </p>
          )}

          {sourcesToShow.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Comparable sources
              </p>
              <div className="space-y-1.5">
                {sourcesToShow.map((source, index) => (
                  <div key={`${source.name}-${index}`} className="rounded-md border border-border/70 bg-background/60 p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">{source.name}</p>
                      <p className="shrink-0 text-muted-foreground">
                        {source.low != null && source.high != null
                          ? `${formatCurrency(source.low)} – ${formatCurrency(source.high)}`
                          : formatCurrency(source.value)}
                      </p>
                    </div>
                    {variant === "detail" && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {[
                          source.confidence ? `${source.confidence} confidence` : null,
                          source.sampleSize != null ? `${source.sampleSize} samples` : null,
                          source.asOf ? `as of ${source.asOf}` : null,
                          source.detail,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
