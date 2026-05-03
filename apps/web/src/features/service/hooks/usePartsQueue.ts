import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  normalizePartsQueueItems,
  type PartsQueueItem,
} from "../lib/service-hook-normalizers";

export type { PartsQueueItem } from "../lib/service-hook-normalizers";

export function usePartsQueue() {
  return useQuery({
    queryKey: ["parts-queue"],
    queryFn: async () => {
      const result = await supabase
        .from("service_parts_requirements")
        .select(`
          *,
          job:service_jobs!service_parts_requirements_job_id_fkey(
            id, fulfillment_run_id, customer_problem_summary, priority, status_flags,
            customer:crm_companies!service_jobs_customer_id_fkey(id, name),
            machine:crm_equipment!service_jobs_machine_id_fkey(id, make, model, serial_number)
          ),
          actions:service_parts_actions(id, action_type, completed_at, expected_date, po_reference),
          staging:service_parts_staging(bin_location, staged_at)
        `)
        .not("status", "in", '("consumed","returned","cancelled")')
        .order("need_by_date", { ascending: true, nullsFirst: false });
      const { data, error } = result;

      if (error) throw error;
      return normalizePartsQueueItems(data);
    },
    staleTime: 30_000,
  });
}
