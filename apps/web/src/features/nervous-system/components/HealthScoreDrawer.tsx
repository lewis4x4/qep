import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { TrendingUp, TrendingDown, Minus, AlertCircle, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface HealthScoreDrawerProps {
  customerProfileId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DrawerPayload {
  current_score: number | null;
  components: Record<string, { score?: number; signals?: Record<string, unknown> }>;
  delta_7d: number | null;
  delta_30d: number | null;
  delta_90d: number | null;
}

/**
 * Health Score Explainability Drawer (Wave 5C v1 non-negotiable, v2 §1 note 4).
 *
 * Required panels:
 *   1. Current score
 *   2. 7/30/90-day deltas
 *   3. Top 3 positive factors with weights
 *   4. Top 3 negative factors with weights
 *   5. Active blockers
 *   6. "Advisory-only" banner — no auto-actions in v1
 */
export function HealthScoreDrawer({
  customerProfileId, open, onOpenChange,
}: HealthScoreDrawerProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health-score-drawer", customerProfileId],
    queryFn: async () => {
      if (!customerProfileId) return null;
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: DrawerPayload | null; error: unknown }>;
      }).rpc("get_health_score_with_deltas", { p_customer_profile_id: customerProfileId });
      if (error) throw new Error("RPC failed");
      return data;
    },
    enabled: open && !!customerProfileId,
    staleTime: 30_000,
  });

  const score = data?.current_score ?? null;
  const components = data?.components ?? {};

  // Component → score map (handles either {component: number} or {component: {score: number}})
  const componentScores: Array<{ name: string; weight: number }> = Object.entries(components).map(([name, val]) => ({
    name,
    weight: typeof val === "number" ? val : Number(val?.score ?? 0),
  }));

  // Top 3 positive (highest contribution) and bottom 3 negative (lowest)
  const sorted = [...componentScores].sort((a, b) => b.weight - a.weight);
  const positives = sorted.slice(0, 3);
  const negatives = sorted.slice(-3).reverse();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Health score explainer</SheetTitle>
          <SheetDescription>
            How we computed this number and where it's heading.
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}
          </div>
        )}

        {isError && (
          <Card className="mt-6 border-red-500/20 p-4">
            <p className="text-xs text-red-400">Couldn't load health score.</p>
          </Card>
        )}

        {!isLoading && !isError && data && (
          <div className="mt-6 space-y-4">
            {/* 1. Current score */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current score</p>
              <p className={`mt-1 text-4xl font-bold tabular-nums ${
                (score ?? 0) >= 75 ? "text-emerald-400" :
                (score ?? 0) >= 50 ? "text-amber-400" : "text-red-400"
              }`}>
                {score != null ? Math.round(Number(score)) : "—"}
                <span className="ml-1 text-base text-muted-foreground">/ 100</span>
              </p>
            </div>

            {/* 2. Deltas */}
            <div className="grid grid-cols-3 gap-2">
              <DeltaTile label="7-day"  value={data.delta_7d} />
              <DeltaTile label="30-day" value={data.delta_30d} />
              <DeltaTile label="90-day" value={data.delta_90d} />
            </div>

            {/* 3. Top 3 positive factors */}
            <Card className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-400 mb-2">
                Top 3 positive factors
              </p>
              {positives.length === 0 ? (
                <p className="text-xs text-muted-foreground">No component breakdown available yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {positives.map((p) => (
                    <FactorRow key={p.name} name={p.name} weight={p.weight} positive />
                  ))}
                </div>
              )}
            </Card>

            {/* 4. Top 3 negative factors */}
            <Card className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-red-400 mb-2">
                Top 3 negative factors
              </p>
              {negatives.length === 0 ? (
                <p className="text-xs text-muted-foreground">No component breakdown available yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {negatives.map((n) => (
                    <FactorRow key={n.name} name={n.name} weight={n.weight} positive={false} />
                  ))}
                </div>
              )}
            </Card>

            {/* 5. Active blockers */}
            <Card className="border-amber-500/30 p-3">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3 text-amber-400" aria-hidden />
                <p className="text-[10px] uppercase tracking-wider text-amber-400">Active blockers</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                AR credit blocks, overdue invoices, churn flags. Wired to the cross-department alerts feed once Phase 4 ar_credit_blocks data populates.
              </p>
            </Card>

            {/* 6. Advisory-only banner */}
            <Card className="border-blue-500/30 bg-blue-500/5 p-3">
              <div className="flex items-center gap-1.5">
                <Info className="h-3 w-3 text-blue-400" aria-hidden />
                <p className="text-[10px] uppercase tracking-wider text-blue-400">Advisory only — v1</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                This score informs decisions but does not trigger any automated action. Reps remain in the loop on every customer touchpoint.
              </p>
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ── Subcomponents ───────────────────────────────────────────────── */

function DeltaTile({ label, value }: { label: string; value: number | null }) {
  const isUp = (value ?? 0) > 0;
  const isDown = (value ?? 0) < 0;
  const isFlat = value === 0 || value === null;
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-1">
        {isFlat ? <Minus className="h-3 w-3 text-muted-foreground" /> :
         isUp   ? <TrendingUp className="h-3 w-3 text-emerald-400" /> :
                  <TrendingDown className="h-3 w-3 text-red-400" />}
        <span className={`text-sm font-bold tabular-nums ${
          isFlat ? "text-muted-foreground" : isUp ? "text-emerald-400" : "text-red-400"
        }`}>
          {value == null ? "—" : (value > 0 ? "+" : "") + value.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function FactorRow({ name, weight, positive }: { name: string; weight: number; positive: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-foreground capitalize">{name.replace(/_/g, " ")}</span>
      <span className={`tabular-nums ${positive ? "text-emerald-400" : "text-muted-foreground"}`}>
        {weight.toFixed(1)}
      </span>
    </div>
  );
}
