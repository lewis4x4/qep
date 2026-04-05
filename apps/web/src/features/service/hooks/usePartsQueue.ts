import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PartsQueueItem {
  id: string;
  job_id: string;
  part_number: string;
  description: string | null;
  quantity: number;
  status: string;
  need_by_date: string | null;
  confidence: string;
  vendor_id: string | null;
  job?: {
    id: string;
    customer_problem_summary: string | null;
    priority: string;
    status_flags: string[];
    customer: { id: string; name: string } | null;
    machine: { id: string; make: string; model: string; serial_number: string } | null;
  };
  actions?: {
    id: string;
    action_type: string;
    completed_at: string | null;
    expected_date: string | null;
    po_reference: string | null;
  }[];
}

export function usePartsQueue() {
  return useQuery({
    queryKey: ["parts-queue"],
    queryFn: async () => {
      // Table not in generated types until next type generation
      const result: { data: PartsQueueItem[] | null; error: { message: string } | null } = await (supabase as any)
        .from("service_parts_requirements")
        .select(`
          *,
          job:service_jobs(
            id, customer_problem_summary, priority, status_flags,
            customer:crm_companies(id, name),
            machine:crm_equipment(id, make, model, serial_number)
          ),
          actions:service_parts_actions(id, action_type, completed_at, expected_date, po_reference)
        `)
        .not("status", "in", '("consumed","returned","cancelled")')
        .order("need_by_date", { ascending: true, nullsFirst: false });
      const { data, error } = result;

      if (error) throw error;
      return (data ?? []) as PartsQueueItem[];
    },
    staleTime: 30_000,
  });
}
