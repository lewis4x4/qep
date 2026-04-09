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
import { coerceBlendRowsFromView, type IronRoleBlendInput } from "./iron-roles";

const FIVE_MINUTES = 5 * 60 * 1000;

// Stable empty-array sentinel — returning a fresh `[]` from the hook on
// every render would break React.memo / useMemo downstream because the
// array reference would change even though the contents didn't. This
// constant lets every "loading" / "error" / "empty" render share the
// SAME array instance.
const EMPTY_BLEND: readonly IronRoleBlendInput[] = Object.freeze([]);

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
 *
 * Reference stability: the hook returns the SAME array reference across
 * renders when the underlying data has not changed. React Query already
 * keeps the resolved `query.data` reference stable across re-renders, but
 * the empty-state fallback path (`?? []`) used to allocate a fresh `[]`
 * on every render, breaking memoization downstream. The shared
 * `EMPTY_BLEND` sentinel fixes that.
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
      // All row narrowing + defensive coercion lives in
      // `coerceBlendRowsFromView` (iron-roles.ts) so the hook stays a
      // thin React Query wrapper. The pure helper is unit-tested.
      return coerceBlendRowsFromView(data);
    },
  });

  return {
    // Cast away `readonly` only at the boundary — callers receive a normal
    // mutable array type, but the underlying instance is the frozen shared
    // sentinel and they should treat it as read-only. The helpers in
    // iron-roles.ts never mutate.
    blend: query.data ?? (EMPTY_BLEND as IronRoleBlendInput[]),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
