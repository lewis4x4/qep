import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Sparkles, RefreshCw, Check, ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from "recharts";

interface DgeIntelligencePanelProps {
  dealId: string;
  dealAmount?: number;
  userRole: string;
}

interface VariableBreakdown {
  id: string;
  variable_name: string;
  variable_value: number;
  variable_unit: string;
  weight: number;
  impact_direction: "positive" | "negative" | "neutral";
  description: string;
  display_order: number;
}

interface Scenario {
  type: string;
  label: string;
  equipment_price?: number;
  trade_allowance?: number;
  total_deal_value?: number;
  total_margin?: number;
  margin_pct?: number;
  close_probability?: number;
  expected_value?: number;
  reasoning?: string;
  dge_variable_breakdown?: VariableBreakdown[];
}

interface ScenarioResponse {
  scenarios: (Scenario & { id: string; scenario_type: string })[];
  selected_scenario: string | null;
}

function formatCurrency(v: number | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function formatPct(v: number | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

const SCENARIO_STYLES: Record<string, { border: string; badge: string; accent: string; ring: string }> = {
  conservative: { border: "border-blue-500/30", badge: "bg-blue-500/10 text-blue-400", accent: "#3b82f6", ring: "" },
  balanced: { border: "border-qep-orange/30", badge: "bg-qep-orange/10 text-qep-orange", accent: "#f97316", ring: "ring-1 ring-qep-orange/20" },
  aggressive: { border: "border-red-500/30", badge: "bg-red-500/10 text-red-400", accent: "#ef4444", ring: "" },
};

const SCENARIO_TYPE_MAP: Record<string, string> = {
  max_margin: "conservative",
  balanced: "balanced",
  win_the_deal: "aggressive",
};

function MarginWaterfallChart({ scenario }: { scenario: Scenario }) {
  if (!scenario.total_deal_value) return null;

  const margin = scenario.total_margin ?? scenario.total_deal_value * (scenario.margin_pct ?? 0) / 100;
  const trade = scenario.trade_allowance ?? 0;
  const price = scenario.equipment_price ?? scenario.total_deal_value;

  const waterfallData = [
    { name: "List Price", value: price, fill: "#3b82f6" },
    { name: "Trade Allow.", value: -trade, fill: "#ef4444" },
    { name: "Gross Margin", value: margin, fill: scenario.margin_pct && scenario.margin_pct >= 15 ? "#22c55e" : "#f59e0b" },
  ];

  return (
    <div className="h-36 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={waterfallData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            formatter={(v: unknown) => formatCurrency(Math.abs(Number(v)))}
            contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#94a3b8" }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {waterfallData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function VariableBreakdownTable({ breakdown }: { breakdown: VariableBreakdown[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...breakdown].sort((a, b) => a.display_order - b.display_order);
  const visible = expanded ? sorted : sorted.slice(0, 5);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          14-Variable Breakdown
        </span>
        {sorted.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Less" : `+${sorted.length - 5} more`}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {visible.map((v) => {
          const impactColor = v.impact_direction === "positive"
            ? "text-emerald-400"
            : v.impact_direction === "negative"
            ? "text-red-400"
            : "text-slate-400";
          const barWidth = Math.min((v.weight ?? 0) * 100 / 0.15, 100);
          return (
            <div key={v.id || v.variable_name} className="flex items-center gap-2 text-[11px]">
              <div className="w-28 truncate text-muted-foreground">{v.variable_name}</div>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${v.impact_direction === "positive" ? "bg-emerald-500/60" : v.impact_direction === "negative" ? "bg-red-500/60" : "bg-slate-500/40"}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <div className={`w-14 text-right font-mono ${impactColor}`}>
                {v.variable_unit === "usd" ? formatCurrency(v.variable_value) : v.variable_unit === "pct" ? `${v.variable_value}%` : v.variable_value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DgeIntelligencePanel({ dealId, dealAmount, userRole }: DgeIntelligencePanelProps) {
  const queryClient = useQueryClient();
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);
  const canSeeMargins = userRole === "manager" || userRole === "owner";

  const { data: scenarioData, isLoading } = useQuery({
    queryKey: ["dge-scenarios", dealId],
    queryFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dge-optimizer?deal_id=${dealId}`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (!res.ok) throw new Error("Failed to load DGE scenarios");
      return res.json() as Promise<ScenarioResponse>;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dge-scenarios", dealId] });
    },
  });

  const selectMutation = useMutation({
    mutationFn: async (scenarioType: string) => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dge-optimizer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deal_id: dealId, action: "select", scenario_type: scenarioType }),
      });
      if (!res.ok) throw new Error("Failed to record selection");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dge-scenarios", dealId] });
    },
  });

  const scenarios = scenarioData?.scenarios ?? [];
  const selectedScenario = scenarioData?.selected_scenario ?? null;

  // Map DB scenario types to display types
  const mappedScenarios = scenarios.map((s) => ({
    ...s,
    displayType: SCENARIO_TYPE_MAP[s.scenario_type] || s.scenario_type || s.type || "balanced",
  }));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-qep-orange" />
          <h3 className="text-sm font-semibold text-foreground">Deal Genome Engine</h3>
          {scenarios.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{scenarios.length} scenarios</span>
          )}
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

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading scenarios...</span>
        </div>
      )}

      {!isLoading && scenarios.length === 0 && !generateMutation.isPending && (
        <div className="text-center py-6">
          <TrendingUp className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">Generate 3 optimized deal scenarios using the 14-variable DGE engine.</p>
          {dealAmount && (
            <p className="text-xs text-muted-foreground mt-1">Deal value: {formatCurrency(dealAmount)}</p>
          )}
        </div>
      )}

      {mappedScenarios.length > 0 && (
        <div className="space-y-3">
          {mappedScenarios.map((s) => {
            const displayType = s.displayType;
            const style = SCENARIO_STYLES[displayType] || SCENARIO_STYLES.balanced;
            const isSelected = selectedScenario === displayType || selectedScenario === s.scenario_type;
            const isExpanded = expandedScenario === displayType;
            const breakdown = s.dge_variable_breakdown ?? [];

            return (
              <Card key={displayType} className={`p-3 ${style.border} ${style.ring} ${isSelected ? "ring-2 ring-qep-orange/40" : ""}`}>
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedScenario(isExpanded ? null : displayType)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>
                      {s.label || displayType}
                    </span>
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[10px] text-qep-orange">
                        <Check className="w-3 h-3" /> Selected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isSelected && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectMutation.mutate(displayType);
                        }}
                      >
                        Select
                      </Button>
                    )}
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                  {s.equipment_price != null && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">Price</div>
                      <div className="font-medium">{formatCurrency(s.equipment_price)}</div>
                    </div>
                  )}
                  {s.trade_allowance != null && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">Trade</div>
                      <div className="font-medium text-emerald-400">{formatCurrency(s.trade_allowance)}</div>
                    </div>
                  )}
                  {s.margin_pct != null && canSeeMargins && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">Margin</div>
                      <div className={`font-bold ${s.margin_pct >= 20 ? "text-emerald-400" : s.margin_pct >= 10 ? "text-amber-400" : "text-red-400"}`}>
                        {formatPct(s.margin_pct)}
                      </div>
                    </div>
                  )}
                  {s.close_probability != null && (
                    <div>
                      <div className="text-[10px] text-muted-foreground">Close %</div>
                      <div className="font-medium">{s.close_probability}%</div>
                    </div>
                  )}
                </div>

                {/* Expanded: margin waterfall + variable breakdown */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    {s.reasoning && (
                      <p className="text-xs italic text-muted-foreground mb-3">{s.reasoning}</p>
                    )}

                    {canSeeMargins && <MarginWaterfallChart scenario={s} />}

                    {breakdown.length > 0 && (
                      <VariableBreakdownTable breakdown={breakdown} />
                    )}

                    {s.expected_value != null && canSeeMargins && (
                      <div className="mt-3 flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted/50">
                        <span className="text-[10px] text-muted-foreground">Expected Value</span>
                        <span className="text-sm font-bold text-qep-orange">{formatCurrency(s.expected_value)}</span>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Card>
  );
}
