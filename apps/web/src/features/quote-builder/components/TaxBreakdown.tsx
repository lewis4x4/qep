import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Sparkles, Calendar, Shield } from "lucide-react";
import { calculateTax } from "../lib/tax-api";

interface TaxBreakdownProps {
  dealId: string;
  branchSlug?: string;
  equipmentCost: number;
  taxYear?: number;
  effectiveTaxRate?: number;
  enabled?: boolean;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function TaxBreakdown({
  dealId,
  branchSlug,
  equipmentCost,
  taxYear = new Date().getFullYear(),
  effectiveTaxRate = 0.25,
  enabled = true,
}: TaxBreakdownProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["quote", "tax", dealId, branchSlug, equipmentCost, taxYear],
    queryFn: () => calculateTax({
      deal_id: dealId,
      branch_slug: branchSlug,
      include_179: true,
      tax_year: taxYear,
      effective_tax_rate: effectiveTaxRate,
    }),
    enabled: enabled && !!dealId && equipmentCost > 0,
    staleTime: 60_000,
  });

  if (!enabled || !dealId || equipmentCost <= 0) return null;

  if (isLoading) {
    return <Card className="animate-pulse p-4"><div className="h-24 rounded bg-muted" /></Card>;
  }

  if (isError || !data) {
    return (
      <Card className="border-amber-500/20 p-4">
        <p className="text-xs text-amber-400">Unable to calculate tax. Continue manually.</p>
      </Card>
    );
  }

  const endOfYear = new Date(taxYear, 11, 31);
  const daysUntilYearEnd = Math.ceil((endOfYear.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const showUrgency = daysUntilYearEnd > 0 && daysUntilYearEnd < 120 && data.section_179;

  return (
    <div className="space-y-3">
      {/* Tax lines */}
      {data.tax_lines.length > 0 ? (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Tax Breakdown</h3>
          <div className="space-y-2">
            {data.tax_lines.map((line, i) => (
              <div key={i} className="flex justify-between text-sm">
                <div>
                  <p className="text-foreground">{line.description}</p>
                  <p className="text-xs text-muted-foreground">{(line.rate * 100).toFixed(3)}% on {line.applies_to.replace(/_/g, " ")}</p>
                </div>
                <p className="font-semibold">{formatCurrency(line.amount)}</p>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-2 text-sm">
              <span className="font-bold text-foreground">Total Tax</span>
              <span className="font-bold text-qep-orange">{formatCurrency(data.total_tax)}</span>
            </div>
          </div>
        </Card>
      ) : data.exemptions_applied.length > 0 ? (
        <Card className="border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-400" />
            <p className="text-sm font-semibold text-emerald-400">Tax Exempt</p>
          </div>
          <ul className="mt-2 space-y-0.5 text-xs text-emerald-300">
            {data.exemptions_applied.map((e, i) => (
              <li key={i}>✓ {e}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Section 179 */}
      {data.section_179 && data.section_179.total_deduction > 0 && (
        <Card className={`p-4 ${showUrgency ? "border-qep-orange/30 bg-qep-orange/5" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-qep-orange" />
              <h3 className="text-sm font-semibold text-foreground">Section 179 Tax Savings</h3>
            </div>
            {showUrgency && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-qep-orange">
                <Calendar className="h-3 w-3" />
                {daysUntilYearEnd}d until year end
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Section 179 Deduction</p>
              <p className="font-semibold">{formatCurrency(data.section_179.deduction)}</p>
            </div>
            {data.section_179.bonus > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Bonus Depreciation</p>
                <p className="font-semibold">{formatCurrency(data.section_179.bonus)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Tax Savings</p>
              <p className="font-bold text-emerald-400">{formatCurrency(data.section_179.tax_savings)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net Cost After Tax</p>
              <p className="font-bold text-qep-orange">{formatCurrency(data.section_179.net_cost)}</p>
            </div>
          </div>

          {showUrgency && (
            <p className="mt-3 text-xs italic text-muted-foreground">
              Place this machine in service by December 31 to claim {formatCurrency(data.section_179.tax_savings)} in tax savings for {taxYear}.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
