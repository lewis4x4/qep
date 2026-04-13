import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { DollarSign, Loader2 } from "lucide-react";
import { calculateFinancing } from "../lib/quote-api";
import type { QuoteFinanceScenario } from "../../../../../../shared/qep-moonshot-contracts";

interface FinancingPreviewCardProps {
  netTotal: number;
  marginPct: number;
  make?: string;
  /** Key that changes when equipment changes — triggers recalculation */
  equipmentKey: string;
}

export function FinancingPreviewCard({ netTotal, marginPct, make, equipmentKey }: FinancingPreviewCardProps) {
  const mutation = useMutation({
    mutationFn: () => calculateFinancing(netTotal, marginPct, make),
  });

  useEffect(() => {
    if (netTotal > 0) {
      mutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentKey, netTotal, marginPct]);

  const scenarios: QuoteFinanceScenario[] = mutation.data?.scenarios ?? [];

  if (netTotal <= 0) return null;

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-qep-orange" />
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Financing Preview</p>
      </div>

      {mutation.isPending && (
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
                    ? `$${netTotal.toLocaleString()}`
                    : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {mutation.isError && (
        <p className="text-xs text-muted-foreground">Financing preview unavailable</p>
      )}
    </Card>
  );
}
