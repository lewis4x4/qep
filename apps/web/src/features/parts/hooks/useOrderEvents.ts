import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { normalizeOrderEvents, type OrderEvent } from "../lib/parts-row-normalizers";

export type { OrderEvent } from "../lib/parts-row-normalizers";

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

        return normalizeOrderEvents(data);
      } catch {
        const { data, error } = await supabase
          .from("parts_order_events")
          .select("*")
          .eq("parts_order_id", orderId!)
          .order("created_at", { ascending: true })
          .limit(200);
        if (error) throw error;
        return normalizeOrderEvents(data);
      }
    },
  });
}
