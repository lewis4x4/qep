import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

interface WorkspaceProfileRow {
  active_workspace_id: string | null;
}

export async function resolveProfileActiveWorkspaceId(
  adminClient: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await adminClient
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", userId)
    .maybeSingle<WorkspaceProfileRow>();

  if (error) {
    throw error;
  }

  const workspaceId = data?.active_workspace_id?.trim();
  if (!workspaceId) {
    throw new Error(`Active workspace missing for user ${userId}`);
  }

  return workspaceId;
}

export async function resolveEffectiveWorkspaceId(params: {
  adminClient: SupabaseClient;
  userId: string;
  callerClient?: SupabaseClient;
}): Promise<string> {
  const { adminClient, callerClient, userId } = params;
  const profileWorkspaceId = await resolveProfileActiveWorkspaceId(adminClient, userId);

  if (callerClient) {
    const { data, error } = await callerClient.rpc("get_my_workspace");
    if (error) {
      console.warn("[workspace] rpc get_my_workspace failed; using profile.active_workspace_id", {
        userId,
        error: error.message,
      });
      return profileWorkspaceId;
    }
    if (typeof data === "string" && data.trim() && data !== profileWorkspaceId) {
      console.warn("[workspace] resolver disagreement; using profile.active_workspace_id", {
        userId,
        claimWorkspaceId: data,
        profileWorkspaceId,
      });
    }
  }

  return profileWorkspaceId;
}
