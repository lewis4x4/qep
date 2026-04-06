import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { calculateFinancing } from "../lib/quote-api";

interface FinancingCalculatorProps {
  totalAmount: number;
  marginPct?: number;
}

interface Scenario {
  type: string;
  term_months: number;
  rate: number;
  monthly_payment: number;
  total_cost: number;
  lender: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function FinancingCalculator({ totalAmount, marginPct }: FinancingCalculatorProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["quote", "financing", totalAmount, marginPct],
    queryFn: () => calculateFinancing(totalAmount, marginPct),
    enabled: totalAmount > 0,
    staleTime: 60_000,
  });

  if (totalAmount <= 0) return null;

  if (isLoading) {
    return <Card className="animate-pulse p-4"><div className="h-20 rounded bg-muted" /></Card>;
  }

  if (isError) {
    return <Card className="border-red-500/20 p-4"><p className="text-sm text-red-400">Failed to calculate financing.</p></Card>;
  }

  const scenarios: Scenario[] = data?.scenarios ?? [];
  const marginCheck = data?.margin_check;
  const incentives = data?.incentives as {
    applicable?: Array<{ id: string; name: string; oem_name?: string; discount_type: string; discount_value: number; estimated_savings: number; end_date?: string }>;
    total_savings?: number;
  } | undefined;

  return (
    <div className="space-y-3">
      {marginCheck?.flagged && (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm font-semibold text-red-400">Margin Below 10%</p>
          <p className="mt-1 text-xs text-red-300">{marginCheck.message}</p>
        </Card>
      )}

      {/* Auto-applied manufacturer incentives */}
      {incentives && (incentives.applicable?.length ?? 0) > 0 && (
        <Card className="border-qep-orange/30 bg-qep-orange/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-qep-orange">Active Incentives Applied</p>
            <p className="text-sm font-bold text-qep-orange">-{formatCurrency(incentives.total_savings ?? 0)}</p>
          </div>
          <ul className="mt-2 space-y-1">
            {(incentives.applicable ?? []).map((inc) => (
              <li key={inc.id} className="flex justify-between text-xs">
                <span className="text-foreground">
                  {inc.name || inc.oem_name || "Incentive"}
                  {inc.end_date && <span className="text-muted-foreground"> (exp {inc.end_date})</span>}
                </span>
                <span className="font-semibold text-emerald-400">-{formatCurrency(inc.estimated_savings)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {scenarios.map((s) => (
          <Card key={s.type} className={`p-4 ${s.type === "cash" ? "border-emerald-500/30" : ""}`}>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{s.type}</p>
            {s.type === "cash" ? (
              <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(s.total_cost)}</p>
            ) : (
              <>
                <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(s.monthly_payment)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.term_months} months @ {s.rate}% • Total: {formatCurrency(s.total_cost)}
                </p>
                <p className="text-xs text-muted-foreground">{s.lender}</p>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
