import { useQuery } from "@tanstack/react-query";
import { getServiceJob, listServiceJobs } from "../lib/api";
import type { ServiceListFilters } from "../lib/types";

export function useServiceJobList(filters: ServiceListFilters = {}) {
  return useQuery({
    queryKey: ["service-jobs", filters],
    queryFn: () => listServiceJobs(filters),
    staleTime: 30_000,
  });
}

export function useServiceJob(id: string | undefined) {
  return useQuery({
    queryKey: ["service-job", id],
    queryFn: () => getServiceJob(id!),
    enabled: !!id,
    staleTime: 15_000,
  });
}
