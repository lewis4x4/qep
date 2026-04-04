import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Sparkles, RefreshCw } from "lucide-react";

interface DgeScenarioPanelProps {
  dealId: string;
}

interface Scenario {
  type: string;
  label: string;
  equipment_price?: number;
  trade_allowance?: number;
  margin_pct?: number;
  close_probability?: number;
  expected_value?: number;
  reasoning?: string;
}

function formatCurrency(v: number | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

const SCENARIO_STYLES: Record<string, { border: string; badge: string }> = {
  conservative: { border: "border-blue-500/30", badge: "bg-blue-500/10 text-blue-400" },
  balanced: { border: "border-qep-orange/30 ring-1 ring-qep-orange/20", badge: "bg-qep-orange/10 text-qep-orange" },
  aggressive: { border: "border-red-500/30", badge: "bg-red-500/10 text-red-400" },
};

export function DgeScenarioPanel({ dealId }: DgeScenarioPanelProps) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dge-optimizer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deal_id: dealId }),
      });
      if (!res.ok) throw new Error("DGE optimization failed");
      return res.json();
    },
    onSuccess: (data) => setScenarios(data.scenarios ?? []),
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-qep-orange" />
          <h3 className="text-sm font-semibold text-foreground">Deal Genome Engine</h3>
        </div>
        <Button
          size="sm" variant="outline"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${generateMutation.isPending ? "animate-spin" : ""}`} />
          {scenarios.length > 0 ? "Refresh" : "Generate Scenarios"}
        </Button>
      </div>

      {scenarios.length === 0 && !generateMutation.isPending && (
        <p className="text-sm text-muted-foreground">Generate 3 optimized deal scenarios using the 14-variable DGE engine.</p>
      )}

      {scenarios.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {scenarios.map((s) => {
            const style = SCENARIO_STYLES[s.type] || SCENARIO_STYLES.balanced;
            return (
              <Card key={s.type} className={`p-3 ${style.border}`}>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>
                  {s.label || s.type}
                </span>
                <div className="mt-3 space-y-1.5 text-sm">
                  {s.equipment_price != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Price</span>
                      <span className="font-medium">{formatCurrency(s.equipment_price)}</span>
                    </div>
                  )}
                  {s.trade_allowance != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Trade</span>
                      <span className="font-medium text-emerald-400">-{formatCurrency(s.trade_allowance)}</span>
                    </div>
                  )}
                  {s.margin_pct != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Margin</span>
                      <span className={`font-bold ${s.margin_pct >= 20 ? "text-emerald-400" : s.margin_pct >= 10 ? "text-amber-400" : "text-red-400"}`}>
                        {s.margin_pct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {s.close_probability != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Close %</span>
                      <span className="font-medium">{s.close_probability}%</span>
                    </div>
                  )}
                </div>
                {s.reasoning && (
                  <p className="mt-2 text-[10px] italic text-muted-foreground">{s.reasoning}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Card>
  );
}
