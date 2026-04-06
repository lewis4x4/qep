import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PartsSubNav } from "../components/PartsSubNav";
import { usePartsAnalytics, useVendorTrends, usePartsVelocityLive } from "../hooks/usePartsAnalytics";

function dollars(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  return `${n.toFixed(0)}%`;
}

function Bar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function PartsAnalyticsPage() {
  const analyticsQ = usePartsAnalytics();
  const vendorQ = useVendorTrends();
  const velocityQ = usePartsVelocityLive();

  const snap = analyticsQ.data;
  const vendors = vendorQ.data ?? [];
  const velocity = velocityQ.data;

  const isLoading = analyticsQ.isLoading || vendorQ.isLoading || velocityQ.isLoading;
  const hasError = analyticsQ.isError || vendorQ.isError || velocityQ.isError;

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Parts analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Revenue, margin, velocity, vendor performance, and customer concentration.
        </p>
      </div>

      {hasError && (
        <Card className="p-4 text-sm text-destructive border-destructive/40" role="alert">
          Some analytics data failed to load. Showing available data.
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4 space-y-2">
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
              <div className="h-7 w-24 rounded bg-muted animate-pulse" />
            </Card>
          ))}
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase">Revenue</p>
              <p className="text-2xl font-semibold tabular-nums">{dollars(snap?.total_revenue)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase">Cost</p>
              <p className="text-2xl font-semibold tabular-nums">{dollars(snap?.total_cost)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase">Margin</p>
              <p className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {dollars(snap?.total_margin)}
              </p>
              {snap && snap.total_revenue > 0 && (
                <p className="text-xs text-muted-foreground">
                  {((snap.total_margin / snap.total_revenue) * 100).toFixed(1)}%
                </p>
              )}
            </Card>
            <Card className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase">Inventory value</p>
              <p className="text-2xl font-semibold tabular-nums">{dollars(snap?.total_inventory_value)}</p>
              {snap && snap.dead_stock_count > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {dollars(snap.dead_stock_value)} dead stock ({snap.dead_stock_count} parts)
                </p>
              )}
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Revenue by category */}
            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-medium">Revenue by category</h2>
              {!snap?.revenue_by_category?.length ? (
                <p className="text-xs text-muted-foreground">No category data available.</p>
              ) : (
                <div className="space-y-2">
                  {snap.revenue_by_category.slice(0, 10).map((c) => (
                    <div key={c.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium truncate">{c.category}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="tabular-nums">{dollars(c.revenue)}</span>
                          <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {dollars(c.margin)}
                          </span>
                        </div>
                      </div>
                      <Bar
                        value={c.revenue}
                        max={snap.revenue_by_category[0]?.revenue ?? 1}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Revenue by source */}
            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-medium">Revenue by channel</h2>
              {!snap?.revenue_by_source?.length ? (
                <p className="text-xs text-muted-foreground">No channel data available.</p>
              ) : (
                <div className="space-y-2">
                  {snap.revenue_by_source.map((s) => (
                    <div key={s.order_source} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium capitalize">{s.order_source.replace(/_/g, " ")}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="tabular-nums">{dollars(s.revenue)}</span>
                          <span className="text-muted-foreground">{s.order_count} orders</span>
                        </div>
                      </div>
                      <Bar
                        value={s.revenue}
                        max={snap.revenue_by_source[0]?.revenue ?? 1}
                        color="bg-blue-500"
                      />
                    </div>
                  ))}
                </div>
              )}

              <h2 className="text-sm font-medium pt-2">Order metrics</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase">Orders</p>
                  <p className="font-semibold tabular-nums">{snap?.order_count ?? 0}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase">Line items</p>
                  <p className="font-semibold tabular-nums">{snap?.line_count ?? 0}</p>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Fastest moving parts */}
            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-medium">Fastest-moving parts</h2>
              {!velocity?.fastest.length ? (
                <p className="text-xs text-muted-foreground">No velocity data.</p>
              ) : (
                <div className="space-y-1.5">
                  {velocity.fastest.slice(0, 10).map((p, i) => (
                    <div key={p.part_number} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
                      <span className="font-mono font-medium">{p.part_number}</span>
                      <span className="text-muted-foreground truncate flex-1">{p.description}</span>
                      <span className="tabular-nums shrink-0">{p.total_qty} units</span>
                      <span className="tabular-nums shrink-0 text-muted-foreground">{dollars(p.total_revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Dead / slow stock */}
            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-medium">Slow-moving inventory</h2>
              {!velocity?.slowest.length ? (
                <p className="text-xs text-muted-foreground">No slow-moving stock detected.</p>
              ) : (
                <div className="space-y-1.5">
                  {velocity.slowest.map((p) => {
                    const daysSince = Math.ceil(
                      (Date.now() - new Date(p.updated_at).getTime()) / 86_400_000,
                    );
                    return (
                      <div key={p.part_number} className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-medium">{p.part_number}</span>
                        <span className="text-muted-foreground truncate flex-1">
                          {p.qty_on_hand} on hand
                        </span>
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400 shrink-0">
                          {daysSince}d idle
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Top customers */}
            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-medium">Top customers by parts revenue</h2>
              {!snap?.top_customers?.length ? (
                <p className="text-xs text-muted-foreground">No customer data.</p>
              ) : (
                <div className="space-y-1.5">
                  {snap.top_customers.slice(0, 10).map((c, i) => (
                    <div key={c.company_id} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
                      <span className="font-medium truncate flex-1">{c.company_name}</span>
                      <span className="tabular-nums shrink-0">{dollars(c.revenue)}</span>
                      <span className="text-muted-foreground shrink-0">{c.order_count} orders</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Vendor performance */}
            <Card className="p-4 space-y-3">
              <h2 className="text-sm font-medium">Vendor performance</h2>
              {vendors.length === 0 ? (
                <p className="text-xs text-muted-foreground">No vendor data.</p>
              ) : (
                <div className="space-y-2">
                  {vendors.slice(0, 10).map((v) => (
                    <div key={v.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{v.name}</span>
                          {v.machine_down_priority && (
                            <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-600 dark:text-red-400">
                              Rush
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                          <span>Score: {v.composite_score?.toFixed(0) ?? "—"}</span>
                          <span>Fill: {pct(v.fill_rate ? v.fill_rate * 100 : null)}</span>
                        </div>
                      </div>
                      <Bar
                        value={v.composite_score ?? 0}
                        max={100}
                        color={
                          (v.composite_score ?? 0) >= 70 ? "bg-emerald-500" :
                          (v.composite_score ?? 0) >= 50 ? "bg-amber-500" : "bg-red-500"
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
