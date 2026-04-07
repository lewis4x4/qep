import { useAuth } from "./useAuth";

/**
 * The caller's currently-active workspace id.
 *
 * Prior to migration 203 this hook queried `profile_workspaces` and
 * heuristically picked one membership (prefer 'default', else alphabetical
 * first). That produced per-device drift and was not persisted.
 *
 * With migration 203, `profiles.active_workspace_id` is the single source
 * of truth. It is loaded by `useAuth` as part of the profile SELECT, so
 * this hook is now a zero-query read. The `useQuery`-compatible shape is
 * preserved so the 11 existing consumers don't need edits.
 */
export function useMyWorkspaceId() {
  const { profile, loading } = useAuth();
  const workspaceId = profile?.active_workspace_id ?? null;

  return {
    data: workspaceId,
    isLoading: loading,
    isPending: loading,
    isError: false as const,
    error: null,
    isSuccess: !loading && workspaceId !== null,
  };
}
