/**
 * useFloorLayout — loads the composed Floor layout for the caller's role.
 *
 * Resolution order (most specific wins):
 *   1. User override row matching (caller's workspace, user, role)
 *   2. Role default row matching (caller's workspace, role, user_id IS NULL)
 *   3. Fallback — empty layout with narrative enabled
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

const FLOOR_LAYOUT_SELECT =
  "id, workspace_id, iron_role, user_id, layout_json, updated_by, created_at, updated_at";

async function fetchRoleDefault(role: IronRole): Promise<FloorLayoutRow | null> {
  const { data, error } = await supabase
    .from("floor_layouts")
    .select(FLOOR_LAYOUT_SELECT)
    .eq("iron_role", role)
    .is("user_id", null)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as FloorLayoutRow | null) ?? null;
}

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
  /** Whether the active layout is a per-user override or a role default. */
  source: "user" | "role" | "empty";
}

export function useFloorLayout(role: IronRole, userId?: string | null): UseFloorLayoutResult {
  const query = useQuery({
    queryKey: ["floor-layout", role, userId ?? "role-default"],
    queryFn: async () => {
      if (userId) {
        const { data: override, error: overrideError } = await supabase
          .from("floor_layouts")
          .select(FLOOR_LAYOUT_SELECT)
          .eq("iron_role", role)
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();

        if (overrideError) throw overrideError;
        if (override) return { row: override as FloorLayoutRow, source: "user" as const };
      }

      const roleDefault = await fetchRoleDefault(role);
      return {
        row: roleDefault,
        source: roleDefault ? ("role" as const) : ("empty" as const),
      };
    },
    // Layouts rarely change — long cache, no refetch on focus.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const row = query.data?.row ?? null;
  const source = query.data?.source ?? "empty";

  return {
    layout: row ? normalizeFloorLayout(row.layout_json) : { ...EMPTY_FLOOR_LAYOUT },
    layoutId: row?.id ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: row?.updated_at ?? null,
    source,
  };
}
