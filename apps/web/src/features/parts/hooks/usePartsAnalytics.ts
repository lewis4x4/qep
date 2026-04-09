import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";

export interface CategoryRevenue {
  category: string;
  revenue: number;
  cost: number;
  margin: number;
  line_count: number;
}

export interface SourceRevenue {
  order_source: string;
  revenue: number;
  order_count: number;
}

export interface TopCustomer {
  company_id: string;
  company_name: string;
  revenue: number;
  order_count: number;
}

export interface FastMovingPart {
  part_number: string;
  description: string;
  total_qty: number;
  total_revenue: number;
}

export interface AnalyticsSnapshot {
  id: string;
  snapshot_date: string;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  order_count: number;
  line_count: number;
  revenue_by_category: CategoryRevenue[];
  revenue_by_source: SourceRevenue[];
  top_customers: TopCustomer[];
  fastest_moving: FastMovingPart[];
  total_inventory_value: number;
  dead_stock_value: number;
  dead_stock_count: number;
}

export interface VendorTrend {
  id: string;
  name: string;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  fill_rate: number | null;
  composite_score: number | null;
  machine_down_priority: boolean;
}

export function usePartsAnalytics() {
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  return useQuery<AnalyticsSnapshot | null>({
    queryKey: ["parts-analytics", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 120_000,
    queryFn: async () => {
      if (!workspaceId) return null;
      try {
        const { data, error } = await supabase
          .from("parts_analytics_snapshots")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        return data as AnalyticsSnapshot | null;
      } catch {
        return null;
      }
    },
  });
}

export function useVendorTrends() {
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  return useQuery<VendorTrend[]>({
    queryKey: ["vendor-trends", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 120_000,
    queryFn: async () => {
      if (!workspaceId) return [];
      try {
        const { data, error } = await supabase
          .from("vendor_profiles")
          .select("id, name, avg_lead_time_hours, responsiveness_score, fill_rate, composite_score, machine_down_priority")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .order("composite_score", { ascending: false })
          .limit(20);
        if (error) throw error;
        return (data ?? []) as VendorTrend[];
      } catch {
        return [];
      }
    },
  });
}

export function usePartsVelocityLive() {
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  return useQuery<{ fastest: FastMovingPart[]; slowest: Array<{ part_number: string; description: string; qty_on_hand: number; updated_at: string }> }>({
    queryKey: ["parts-velocity", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 120_000,
    queryFn: async () => {
      if (!workspaceId) return { fastest: [], slowest: [] };
      try {
        const { data: lines } = await supabase
          .from("parts_order_lines")
          .select("part_number, description, quantity, unit_price")
          .eq("workspace_id", workspaceId)
          .limit(500);

        const velocityMap = new Map<string, { desc: string; qty: number; revenue: number }>();
        for (const l of lines ?? []) {
          const pn = l.part_number as string;
          if (!velocityMap.has(pn)) velocityMap.set(pn, { desc: l.description as string, qty: 0, revenue: 0 });
          const v = velocityMap.get(pn)!;
          v.qty += Number(l.quantity);
          v.revenue += Number(l.unit_price) * Number(l.quantity);
        }

        const fastest = [...velocityMap.entries()]
          .map(([pn, d]) => ({ part_number: pn, description: d.desc, total_qty: d.qty, total_revenue: d.revenue }))
          .sort((a, b) => b.total_qty - a.total_qty)
          .slice(0, 15);

        const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
        const { data: inv } = await supabase
          .from("parts_inventory")
          .select("part_number, qty_on_hand, updated_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .gt("qty_on_hand", 0)
          .lt("updated_at", cutoff)
          .order("updated_at", { ascending: true })
          .limit(15);

        const slowest = (inv ?? []).map((r) => ({
          part_number: r.part_number as string,
          description: "",
          qty_on_hand: Number(r.qty_on_hand),
          updated_at: r.updated_at as string,
        }));

        return { fastest, slowest };
      } catch {
        return { fastest: [], slowest: [] };
      }
    },
  });
}
