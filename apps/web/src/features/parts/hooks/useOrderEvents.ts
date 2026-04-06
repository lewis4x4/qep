import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface OrderEvent {
  id: string;
  event_type: string;
  source: string;
  actor_id: string | null;
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name?: string;
}

export function useOrderEvents(orderId: string | null) {
  return useQuery<OrderEvent[]>({
    queryKey: ["order-events", orderId],
    enabled: !!orderId,
    staleTime: 15_000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("parts_order_events")
          .select(`
            id, event_type, source, actor_id, from_status, to_status, metadata, created_at,
            profiles!parts_order_events_actor_id_fkey ( full_name )
          `)
          .eq("parts_order_id", orderId!)
          .order("created_at", { ascending: true })
          .limit(200);

        if (error) throw error;

        return (data ?? []).map((r) => {
          const prof = r.profiles as { full_name?: string } | { full_name?: string }[] | null;
          const name = Array.isArray(prof) ? prof[0]?.full_name : prof?.full_name;
          return {
            id: r.id,
            event_type: r.event_type,
            source: r.source,
            actor_id: r.actor_id,
            from_status: r.from_status,
            to_status: r.to_status,
            metadata: (r.metadata ?? {}) as Record<string, unknown>,
            created_at: r.created_at,
            actor_name: name ?? undefined,
          } as OrderEvent;
        });
      } catch {
        const { data, error } = await supabase
          .from("parts_order_events")
          .select("*")
          .eq("parts_order_id", orderId!)
          .order("created_at", { ascending: true })
          .limit(200);
        if (error) throw error;
        return (data ?? []) as OrderEvent[];
      }
    },
  });
}
