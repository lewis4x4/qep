import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { getTradeValuation } from "../lib/quote-api";
import { Button } from "@/components/ui/button";
import { buildTradeWalkaroundHref } from "@/features/qrm/lib/trade-walkaround";

interface TradeInSectionProps {
  dealId: string;
  onTradeValueChange: (value: number | null, valuationId: string | null) => void;
}

interface TradeRange {
  low: number;
  high: number;
  midpoint: number;
  sources: string[];
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function inferTradeRange(valuation: {
  market_comps?: Array<Record<string, unknown>> | null;
  auction_value?: number | null;
  preliminary_value?: number | null;
  final_value?: number | null;
}): TradeRange | null {
  const points: number[] = [];
  const sources = new Set<string>();
  for (const comp of valuation.market_comps ?? []) {
    const low = numberValue(comp.low ?? comp.low_cents);
    const high = numberValue(comp.high ?? comp.high_cents);
    const value = numberValue(comp.price ?? comp.value ?? comp.value_cents);
    if (low != null && high != null) {
      points.push(low > 10_000 ? low / 100 : low, high > 10_000 ? high / 100 : high);
      sources.add("market comps");
      continue;
    }
    if (value != null) {
      points.push(value > 10_000 ? value / 100 : value);
      sources.add("market comps");
    }
  }
  if (valuation.auction_value != null && valuation.auction_value > 0) {
    points.push(valuation.auction_value);
    sources.add("auction");
  }
  if (points.length === 0) return null;
  const low = Math.min(...points);
  const high = Math.max(...points);
  const midpoint = valuation.final_value ?? valuation.preliminary_value ?? (low + high) / 2;
  if (valuation.final_value != null) sources.add("final appraisal");
  else if (valuation.preliminary_value != null) sources.add("preliminary appraisal");
  return { low, high, midpoint, sources: [...sources] };
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

  const inferredRange = inferTradeRange(valuation);
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
              Source: {inferredRange.sources.join(" + ")}
            </p>
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
