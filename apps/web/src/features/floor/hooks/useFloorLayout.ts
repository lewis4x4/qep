/**
 * useFloorLayout — loads the composed Floor layout for the caller's role.
 *
 * Resolution order (most specific wins):
 *   1. Row in `public.floor_layouts` matching (caller's workspace, role)
 *   2. Fallback — empty layout with narrative enabled
 *
 * We DO NOT fall back to the hardcoded `DEFAULT_WIDGETS` from
 * `features/dashboards/widgets/role-defaults.ts`. Those defaults power the
 * legacy Iron dashboards, which are a different surface. If no
 * floor_layouts row exists for a workspace, Brian sees an empty Floor —
 * which is the correct signal to open the composer and curate one.
 * The seed inserts in migration 374 guarantee the `default` workspace
 * has rows for all 7 roles out of the box.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { IronRole } from "@/features/qrm/lib/iron-roles";
import {
  EMPTY_FLOOR_LAYOUT,
  normalizeFloorLayout,
  type FloorLayout,
  type FloorLayoutRow,
} from "../lib/layout-types";

export interface UseFloorLayoutResult {
  layout: FloorLayout;
  /** Row id — null when no stored layout exists (empty-state fallback). */
  layoutId: string | null;
  /** True while the initial query is in flight. */
  isLoading: boolean;
  /** True if the query resolved with an error. The UI shows an empty
   *  layout in this case — the Floor never hard-fails. */
  isError: boolean;
  /** Timestamp of the stored row's last edit. Null when no row. */
  updatedAt: string | null;
}

export function useFloorLayout(role: IronRole): UseFloorLayoutResult {
  const query = useQuery({
    queryKey: ["floor-layout", role],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_layouts")
        .select("id, workspace_id, iron_role, layout_json, updated_by, created_at, updated_at")
        .eq("iron_role", role)
        // RLS scopes to the caller's workspace automatically — no need
        // to filter by workspace_id client-side.
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return (data as FloorLayoutRow | null) ?? null;
    },
    // Layouts rarely change — long cache, no refetch on focus.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const row = query.data ?? null;

  return {
    layout: row ? normalizeFloorLayout(row.layout_json) : { ...EMPTY_FLOOR_LAYOUT },
    layoutId: row?.id ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: row?.updated_at ?? null,
  };
}
