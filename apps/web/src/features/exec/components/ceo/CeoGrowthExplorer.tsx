import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, HeartPulse, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface BranchRow {
  branch_id: string | null;
  overdue: number | null;
  active: number | null;
  closed: number | null;
}

interface HealthMoverRow {
  customer_profile_id: string | null;
  health_score: number | null;
  health_score_updated_at: string | null;
}

interface CustomerProfileRow {
  id: string;
  customer_name: string;
  company_name: string | null;
  lifetime_value: number | null;
  fleet_size: number | null;
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function CeoGrowthExplorer() {
  const branchQuery = useQuery({
    queryKey: ["ceo", "branch-comparison"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            order: (column: string, options: Record<string, boolean>) => Promise<{ data: BranchRow[] | null; error: { message?: string } | null }>;
          };
        };
      })
        .from("exec_branch_comparison")
        .select("*")
        .order("branch_id", { ascending: true });
      if (error) throw new Error(error.message ?? "Failed to load branch comparison.");
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const moversQuery = useQuery({
    queryKey: ["ceo", "health-movers"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            order: (column: string, options: Record<string, boolean>) => {
              limit: (count: number) => Promise<{ data: HealthMoverRow[] | null; error: { message?: string } | null }>;
            };
          };
        };
      })
        .from("exec_health_movers")
        .select("*")
        .order("health_score", { ascending: true })
        .limit(6);
      if (error) throw new Error(error.message ?? "Failed to load health movers.");
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const profileIds = useMemo(
    () =>
      (moversQuery.data ?? [])
        .map((row) => row.customer_profile_id)
        .filter((value): value is string => Boolean(value)),
    [moversQuery.data],
  );

  const profilesQuery = useQuery({
    queryKey: ["ceo", "health-mover-profiles", profileIds.join(",")],
    enabled: profileIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            in: (column: string, values: string[]) => Promise<{ data: CustomerProfileRow[] | null; error: { message?: string } | null }>;
          };
        };
      })
        .from("customer_profiles_extended")
        .select("id, customer_name, company_name, lifetime_value, fleet_size")
        .in("id", profileIds);
      if (error) throw new Error(error.message ?? "Failed to load customer profiles.");
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const profileById = useMemo(() => {
    const map = new Map<string, CustomerProfileRow>();
    for (const profile of profilesQuery.data ?? []) map.set(profile.id, profile);
    return map;
  }, [profilesQuery.data]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-qep-orange" />
            <h3 className="text-sm font-bold text-foreground">Branch comparison explorer</h3>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/service/dashboard">
              Open service dashboard <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
        {branchQuery.isLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">Loading branch comparison…</p>
        ) : branchQuery.data && branchQuery.data.length > 0 ? (
          <div className="mt-4 space-y-2">
            {branchQuery.data.map((row) => (
              <div key={row.branch_id ?? "unknown"} className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  {row.branch_id ? (
                    <Link to={`/qrm/branches/${row.branch_id}/command`} className="text-sm font-semibold text-foreground hover:text-qep-orange">
                      {row.branch_id}
                    </Link>
                  ) : (
                    <p className="text-sm font-semibold text-foreground">Unknown branch</p>
                  )}
                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span>{row.active ?? 0} active</span>
                    <span>{row.closed ?? 0} closed</span>
                    <span className={Number(row.overdue ?? 0) > 0 ? "text-red-300" : ""}>{row.overdue ?? 0} overdue</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No branch comparison data yet.</p>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-red-300" />
            <h3 className="text-sm font-bold text-foreground">Customer health movers watchlist</h3>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/nervous-system">
              Open nervous system <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
        {moversQuery.isLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">Loading health movers…</p>
        ) : moversQuery.data && moversQuery.data.length > 0 ? (
          <div className="mt-4 space-y-2">
            {moversQuery.data.map((row) => {
              const profile = row.customer_profile_id ? profileById.get(row.customer_profile_id) : null;
              return (
                <div key={row.customer_profile_id ?? "unknown"} className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{profile?.customer_name ?? "Unknown customer"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {profile?.company_name ?? "No company"} · Fleet {profile?.fleet_size ?? 0} · LTV {formatCurrency(profile?.lifetime_value)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${(row.health_score ?? 0) < 40 ? "text-red-300" : (row.health_score ?? 0) < 65 ? "text-amber-300" : "text-emerald-300"}`}>
                        {row.health_score?.toFixed(0) ?? "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">health</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No health movers are flagged right now.</p>
        )}
      </Card>
    </div>
  );
}
