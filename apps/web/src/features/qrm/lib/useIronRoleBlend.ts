/**
 * Phase 0 P0.5 — `useIronRoleBlend`
 *
 * React Query hook that loads the currently-active role blend rows for a
 * single profile from `v_profile_active_role_blend` (migration 210). The
 * shape returned matches `IronRoleBlendInput[]` so callers can pass the
 * result straight into the helpers in `iron-roles.ts` — no manual mapping.
 *
 * Cadence: 5-minute staleness, no auto-refetch. The blend changes only on
 * profile updates and explicit cover-handoff transitions; aggressive polling
 * is wasteful. Cache invalidation on cover-handoff lands in a later slice.
 *
 * Empty-result semantics: an empty array (or null profileId) is NOT a fatal
 * error. Callers should fall back to the legacy single-role path via
 * `getEffectiveIronRole(userRole, blendRows, ironRoleFromProfile)` which
 * already handles the empty case.
 */

import { useQuery } from "@tanstack/react-query";
import { crmSupabase } from "./qrm-supabase";
import type { IronRoleBlendInput } from "./iron-roles";

const FIVE_MINUTES = 5 * 60 * 1000;

export interface UseIronRoleBlendResult {
  blend: IronRoleBlendInput[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Load the active blend rows for a profile.
 *
 * @param profileId — the operator's profile id (typically `auth.uid()`).
 *                    When null/undefined the hook returns an empty blend
 *                    without ever hitting the network.
 */
export function useIronRoleBlend(profileId: string | null | undefined): UseIronRoleBlendResult {
  const query = useQuery({
    queryKey: ["qrm", "role-blend", profileId ?? "anonymous"],
    enabled: Boolean(profileId),
    staleTime: FIVE_MINUTES,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<IronRoleBlendInput[]> => {
      if (!profileId) return [];
      const { data, error } = await crmSupabase
        .from("v_profile_active_role_blend")
        .select("iron_role, weight")
        .eq("profile_id", profileId);
      if (error) throw error;
      // Defensive: the view promises non-null iron_role + numeric weight,
      // but we still narrow to the IronRoleBlendInput contract so future
      // schema drift surfaces here, not deep inside the ranker.
      return (data ?? []).map((row) => ({
        iron_role: row.iron_role,
        weight: Number(row.weight),
      }));
    },
  });

  return {
    blend: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
