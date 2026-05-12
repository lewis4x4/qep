type ProfileRow = {
  id?: unknown;
  active_workspace_id?: unknown;
  [key: string]: unknown;
};

type MembershipRow = {
  profile_id?: unknown;
};

type AuthUserRow = {
  id?: unknown;
  [key: string]: unknown;
};

export function workspaceProfileIdSet(memberships: MembershipRow[] | null | undefined): Set<string> {
  return new Set(
    (memberships ?? [])
      .map((row) => row.profile_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

export function profileBelongsToWorkspace(
  profile: ProfileRow,
  workspaceId: string,
  memberProfileIds: Set<string>,
): boolean {
  return (
    (typeof profile.id === "string" && memberProfileIds.has(profile.id)) ||
    profile.active_workspace_id === workspaceId
  );
}

export function filterProfilesToWorkspace(
  profiles: ProfileRow[] | null | undefined,
  workspaceId: string,
  memberProfileIds: Set<string>,
): ProfileRow[] {
  return (profiles ?? []).filter((profile) =>
    profileBelongsToWorkspace(profile, workspaceId, memberProfileIds)
  );
}

export function filterAuthUsersToProfiles(
  authUsers: AuthUserRow[] | null | undefined,
  allowedProfileIds: Set<string>,
): AuthUserRow[] {
  return (authUsers ?? []).filter((user) =>
    typeof user.id === "string" && allowedProfileIds.has(user.id)
  );
}
