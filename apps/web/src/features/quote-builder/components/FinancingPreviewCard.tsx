import { Card } from "@/components/ui/card";
import { DollarSign, Loader2 } from "lucide-react";
import { useQuoteFinancingPreview } from "../hooks/useQuoteFinancingPreview";
import type { QuoteFinanceScenario } from "../../../../../../shared/qep-moonshot-contracts";
import type { QuoteFinancingRequest } from "../lib/quote-api";

interface FinancingPreviewCardProps {
  input: QuoteFinancingRequest;
}

export function FinancingPreviewCard({ input }: FinancingPreviewCardProps) {
  const previewQuery = useQuoteFinancingPreview(input);
  const scenarios: QuoteFinanceScenario[] = previewQuery.data?.scenarios ?? [];
  const customerTotal = previewQuery.data?.customerTotal ?? input.packageSubtotal - input.discountTotal - input.tradeAllowance + input.taxTotal;

  if (input.packageSubtotal <= 0) return null;

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-qep-orange" />
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Financing Preview</p>
      </div>

      {previewQuery.isLoading && (
        <div className="flex items-center gap-2 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Calculating…</span>
        </div>
      )}

      {scenarios.length > 0 && (
        <div className="space-y-2">
          {scenarios.slice(0, 3).map((s) => (
            <div key={s.label} className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <span className="text-sm font-semibold text-foreground">
                {s.monthlyPayment != null
                  ? `$${Math.round(s.monthlyPayment).toLocaleString()}/mo`
                  : s.type === "cash"
                    ? `$${Math.round(customerTotal).toLocaleString()}`
                    : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {!previewQuery.isLoading && scenarios.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {input.amountFinanced > 0 ? "Financing preview unavailable" : "Cash structure only"}
        </p>
      )}

      {previewQuery.isError && (
        <p className="text-xs text-muted-foreground">Financing preview unavailable</p>
      )}
    </Card>
  );
}
