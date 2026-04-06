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
  /** Lines still in job-code / AI suggestion state are excluded so the queue matches the parts planner. */
  intake_line_status?: string;
  job?: {
    id: string;
    fulfillment_run_id: string | null;
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
  staging?: { bin_location: string | null; staged_at: string }[];
}

export function usePartsQueue() {
  return useQuery({
    queryKey: ["parts-queue"],
    queryFn: async () => {
      const result = await supabase
        .from("service_parts_requirements")
        .select(`
          *,
          job:service_jobs(
            id, fulfillment_run_id, customer_problem_summary, priority, status_flags,
            customer:crm_companies(id, name),
            machine:crm_equipment(id, make, model, serial_number)
          ),
          actions:service_parts_actions(id, action_type, completed_at, expected_date, po_reference),
          staging:service_parts_staging(bin_location, staged_at)
        `)
        .not("status", "in", '("consumed","returned","cancelled")')
        .order("need_by_date", { ascending: true, nullsFirst: false });
      const { data, error } = result;

      if (error) throw error;
      const rows = (data ?? []) as PartsQueueItem[];
      // Align with service-parts-planner: suggested lines must be accepted before planning/ops work.
      return rows.filter(
        (r) => (r.intake_line_status ?? "accepted") !== "suggested",
      );
    },
    staleTime: 30_000,
  });
}
