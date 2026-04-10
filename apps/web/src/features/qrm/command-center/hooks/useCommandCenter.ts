/**
 * React Query hook for the QRM Command Center payload.
 *
 * Cadence remains 60s staleness with a 2m refetch interval so the existing
 * operator expectation about freshness is preserved. The query key
 * MUST include `scope` so switching scopes does not return stale data from
 * another scope.
 */

import { useQuery } from "@tanstack/react-query";
import { getCommandCenter } from "../api/getCommandCenter";
import type { CommandCenterScope } from "../api/commandCenter.types";

export function useCommandCenter(scope: CommandCenterScope) {
  return useQuery({
    queryKey: ["qrm", "command-center", scope],
    queryFn: () => getCommandCenter(scope),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });
}
