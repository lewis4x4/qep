import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

export interface WorkspaceMembership {
  workspace_id: string;
}

/**
 * Returns every workspace the current user belongs to (from the
 * profile_workspaces junction table). Used by the WorkspaceSwitcher to
 * render alternatives. For the currently-active workspace, read
 * `profile.active_workspace_id` from `useAuth()` directly.
 */
export function useWorkspaceMemberships() {
  const { user } = useAuth();

  return useQuery<WorkspaceMembership[]>({
    queryKey: ["workspace-memberships", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const userId = user?.id;
      if (!userId) return [];
      const { data, error } = await supabase
        .from("profile_workspaces")
        .select("workspace_id")
        .eq("profile_id", userId);
      if (error) throw error;
      const rows = (data ?? []) as WorkspaceMembership[];
      // Stable ordering: 'default' first, then alphabetical.
      return rows.sort((a, b) => {
        if (a.workspace_id === "default") return -1;
        if (b.workspace_id === "default") return 1;
        return a.workspace_id.localeCompare(b.workspace_id);
      });
    },
  });
}
