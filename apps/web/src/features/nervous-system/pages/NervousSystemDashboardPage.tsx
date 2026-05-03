import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, Zap, Users, TrendingUp, Package } from "lucide-react";
import { AskIronAdvisorButton } from "@/components/primitives";
import { HealthScoreDrawer } from "../components/HealthScoreDrawer";
import {
  fetchHealthDistribution,
  runHealthRefresh,
  fetchTopCustomerProfiles,
  fetchRevenueByMakeModel,
} from "../lib/nervous-system-api";
import { CustomerHealthScore } from "../components/CustomerHealthScore";
import { CrossDeptAlertFeed } from "../components/CrossDeptAlertFeed";

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

function errorMessage(value: unknown, fallback = "unknown"): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && !Array.isArray(value) && "message" in value) {
    const message = value.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function NervousSystemDashboardPage() {
  const queryClient = useQueryClient();
  const [drawerProfileId, setDrawerProfileId] = useState<string | null>(null);

  const { data: distribution, isLoading: distLoading } = useQuery({
    queryKey: ["nervous-system", "distribution"],
    queryFn: fetchHealthDistribution,
    staleTime: 60_000,
  });

  const { data: topProfiles, isLoading: profilesLoading } = useQuery({
    queryKey: ["nervous-system", "top-profiles"],
    queryFn: () => fetchTopCustomerProfiles(8),
    staleTime: 60_000,
  });

  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ["nervous-system", "revenue-by-make-model"],
    queryFn: () => fetchRevenueByMakeModel(10),
    staleTime: 5 * 60_000,
  });

  const refreshMutation = useMutation({
    mutationFn: runHealthRefresh,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nervous-system"] });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Cross-Department Nervous System</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Every department sees signals from every other department. Health scores, alerts, and revenue attribution — all from live data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AskIronAdvisorButton contextType="nervous_system" variant="inline" />
          <Button
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <Zap className={`mr-1 h-4 w-4 ${refreshMutation.isPending ? "animate-pulse" : ""}`} />
            {refreshMutation.isPending ? "Refreshing…" : "Refresh scores"}
          </Button>
        </div>
      </div>

      {refreshMutation.isSuccess && refreshMutation.data && (
        <Card className="border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs text-emerald-400">
            Refresh complete: {refreshMutation.data.scores_refreshed} scores updated, {refreshMutation.data.alerts_generated} new alerts generated.
          </p>
        </Card>
      )}
      {refreshMutation.isError && (
        <Card className="border-red-500/20 bg-red-500/5 p-3">
          <p className="text-xs text-red-400">
            Refresh failed: {errorMessage(refreshMutation.error)}
          </p>
        </Card>
      )}

      {/* Distribution tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label="Scored customers"
          value={distribution?.total_scored ?? 0}
          accent="text-foreground"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          loading={distLoading}
        />
        <Tile
          label="Average score"
          value={distribution ? distribution.avg_score.toFixed(1) : "—"}
          accent="text-foreground"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          loading={distLoading}
        />
        <Tile
          label="Excellent"
          value={distribution?.distribution.excellent ?? 0}
          accent="text-emerald-400"
          sublabel="≥80"
          loading={distLoading}
        />
        <Tile
          label="Good"
          value={distribution?.distribution.good ?? 0}
          accent="text-blue-400"
          sublabel="60-79"
          loading={distLoading}
        />
        <Tile
          label="At risk"
          value={distribution?.distribution.at_risk ?? 0}
          accent="text-red-400"
          sublabel="<40"
          loading={distLoading}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Alert feed */}
        <div className="lg:col-span-2">
          <CrossDeptAlertFeed />
        </div>

        {/* Right: Revenue by make/model */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-qep-orange" aria-hidden />
            <h3 className="text-sm font-bold text-foreground">Revenue by Model</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">
            Lifetime revenue per unit drives inventory decisions.
          </p>

          {revenueLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 rounded bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {!revenueLoading && (revenueData ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No revenue attribution data yet. Populate revenue_attribution on customer profiles to power this view.
            </p>
          )}

          {!revenueLoading && (revenueData ?? []).length > 0 && (
            <div className="space-y-1.5">
              {(revenueData ?? []).map((row, i) => (
                <div key={`${row.make}-${row.model}-${i}`} className="flex items-center justify-between rounded-md border border-border/40 p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{row.make} {row.model}</p>
                    <p className="text-[10px] text-muted-foreground">{row.unit_count} unit{row.unit_count === 1 ? "" : "s"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-qep-orange">{formatCurrency(row.total_lifetime_revenue)}</p>
                    <p className="text-[10px] text-muted-foreground">{formatCurrency(row.avg_lifetime_revenue_per_unit)}/unit</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Customer health spotlight */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Package className="h-4 w-4 text-qep-orange" aria-hidden />
          <h3 className="text-sm font-bold text-foreground">Customer Health Spotlight</h3>
          <span className="text-[10px] text-muted-foreground">(top 8 by score)</span>
        </div>

        {profilesLoading && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-48 animate-pulse" />
            ))}
          </div>
        )}

        {!profilesLoading && (topProfiles ?? []).length === 0 && (
          <Card className="border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No customer profiles with health scores yet. Click "Refresh scores" to compute them.
            </p>
          </Card>
        )}

        {!profilesLoading && (topProfiles ?? []).length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(topProfiles ?? []).map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => setDrawerProfileId(profile.id)}
                className="text-left transition hover:scale-[1.01]"
              >
                <CustomerHealthScore profile={profile} />
              </button>
            ))}
          </div>
        )}
      </div>

      <HealthScoreDrawer
        customerProfileId={drawerProfileId}
        open={drawerProfileId !== null}
        onOpenChange={(open) => !open && setDrawerProfileId(null)}
      />
    </div>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function Tile({
  label,
  value,
  accent,
  sublabel,
  icon,
  loading,
}: {
  label: string;
  value: string | number;
  accent: string;
  sublabel?: string;
  icon?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-16 rounded bg-muted animate-pulse" />
      ) : (
        <p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p>
      )}
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </Card>
  );
}
