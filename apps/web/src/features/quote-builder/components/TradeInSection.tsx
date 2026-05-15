import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { getTradeValuation } from "../lib/quote-api";
import { Button } from "@/components/ui/button";
import { buildTradeWalkaroundHref } from "@/features/qrm/lib/trade-walkaround";
import { describeTradeCreditBasis, inferTradeRangeSummary } from "../lib/trade-valuation-range";

interface TradeInSectionProps {
  dealId: string;
  onTradeValueChange: (value: number | null, valuationId: string | null) => void;
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function TradeInSection({ dealId, onTradeValueChange }: TradeInSectionProps) {
  const { data: valuation, isLoading } = useQuery({
    queryKey: ["quote", "trade-valuation", dealId],
    queryFn: () => getTradeValuation(dealId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <Card className="animate-pulse p-4"><div className="h-16 rounded bg-muted" /></Card>;
  }

  if (!valuation) {
    return (
      <Card className="border-dashed p-4">
        <p className="text-sm text-muted-foreground">No trade-in valuation on file. Create one from the deal detail page.</p>
        <Button asChild size="sm" variant="outline" className="mt-3">
          <Link to={buildTradeWalkaroundHref(dealId)}>Open trade walkaround</Link>
        </Button>
      </Card>
    );
  }

  const inferredRange = inferTradeRangeSummary({
    marketComps: valuation.market_comps ?? [],
    auctionValue: valuation.auction_value ?? null,
    preliminaryValue: valuation.preliminary_value ?? null,
    finalValue: valuation.final_value ?? null,
  });
  const creditBasis = describeTradeCreditBasis({
    finalValue: valuation.final_value ?? null,
    preliminaryValue: valuation.preliminary_value ?? null,
    inferredRange,
  });
  const hasValue = Boolean(valuation.preliminary_value || valuation.final_value || inferredRange);
  const tradeValue = valuation.final_value ?? valuation.preliminary_value ?? inferredRange?.midpoint ?? null;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-foreground">Trade-In</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Equipment</p>
          <p className="font-medium">{valuation.make} {valuation.model} {valuation.year && `(${valuation.year})`}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Hours</p>
          <p className="font-medium">{valuation.hours?.toLocaleString() ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">AI Condition Score</p>
          <p className="font-medium">{valuation.ai_condition_score ?? "—"}/100</p>
        </div>
        <div>
          <p className="text-muted-foreground">Trade Range</p>
          <p className="font-medium text-qep-orange">
            {inferredRange
              ? `${formatCurrency(inferredRange.low)} - ${formatCurrency(inferredRange.high)}`
              : formatCurrency(valuation.preliminary_value)}
          </p>
          {tradeValue != null && (
            <p className="text-[11px] text-muted-foreground">
              Midpoint: {formatCurrency(tradeValue)}
            </p>
          )}
          {inferredRange && inferredRange.sources.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Rep-facing comps: {inferredRange.sources.slice(0, 3).join(" + ")}
            </p>
          )}
          {inferredRange?.confidence && (
            <p className="text-[11px] text-muted-foreground">
              Confidence: {inferredRange.confidence}{inferredRange.isSynthetic ? " · modeled until live feeds connect" : ""}
            </p>
          )}
          {creditBasis.basis !== "none" && creditBasis.line && (
            <p className="mt-1 text-[11px] text-muted-foreground">{creditBasis.line}</p>
          )}
        </div>
      </div>
      {valuation.conditional_language && (
        <p className="mt-3 text-[10px] italic text-muted-foreground">{valuation.conditional_language}</p>
      )}
      {hasValue && (
        <button
          onClick={() => onTradeValueChange(tradeValue, valuation.id)}
          className="mt-3 w-full rounded bg-qep-orange/10 px-3 py-2 text-sm font-medium text-qep-orange hover:bg-qep-orange/20 transition"
        >
          Apply Trade-In Credit: {formatCurrency(tradeValue)}
        </button>
      )}
    </Card>
  );
}
