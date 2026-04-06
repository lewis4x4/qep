import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

function chooseWorkspaceId(rows: Array<{ workspace_id: string }> | null | undefined): string | null {
  const ids = (rows ?? [])
    .map((row) => row.workspace_id?.trim())
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return null;
  if (ids.includes("default")) return "default";
  return [...ids].sort((a, b) => a.localeCompare(b))[0] ?? null;
}

export function useMyWorkspaceId() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["my-workspace-id", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async () => {
      const userId = user?.id;
      if (!userId) return null;
      const { data, error } = await supabase
        .from("profile_workspaces")
        .select("workspace_id")
        .eq("profile_id", userId);
      if (error) throw error;
      return chooseWorkspaceId(data);
    },
  });
}
