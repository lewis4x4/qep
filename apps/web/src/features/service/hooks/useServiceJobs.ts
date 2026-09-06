import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { getServiceJob, listServiceJobs } from "../lib/api";
import type { ServiceListFilters } from "../lib/types";

export function useServiceJobList(filters: ServiceListFilters = {}) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["service-jobs", filters, profile?.id, profile?.active_workspace_id],
    enabled: !!profile?.id && !!profile?.active_workspace_id,
    queryFn: () => listServiceJobs(filters),
    staleTime: 30_000,
  });
}

export function useServiceJob(id: string | undefined) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["service-job", id, profile?.id, profile?.active_workspace_id],
    queryFn: () => getServiceJob(id!),
    enabled: !!id && !!profile?.id && !!profile?.active_workspace_id,
    staleTime: 15_000,
  });
}
