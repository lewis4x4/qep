import { assertEquals } from "jsr:@std/assert@1";
import {
  filterAuthUsersToProfiles,
  filterProfilesToWorkspace,
  profileBelongsToWorkspace,
  workspaceProfileIdSet,
} from "./workspace-scope.ts";

Deno.test("workspaceProfileIdSet keeps only concrete member ids", () => {
  const ids = workspaceProfileIdSet([
    { profile_id: "user-a" },
    { profile_id: "" },
    { profile_id: null },
    { profile_id: "user-b" },
  ]);

  assertEquals([...ids].sort(), ["user-a", "user-b"]);
});

Deno.test("profileBelongsToWorkspace accepts membership or active workspace only", () => {
  const memberIds = new Set(["member-user"]);

  assertEquals(
    profileBelongsToWorkspace({ id: "member-user", active_workspace_id: "other" }, "workspace-a", memberIds),
    true,
  );
  assertEquals(
    profileBelongsToWorkspace({ id: "active-user", active_workspace_id: "workspace-a" }, "workspace-a", memberIds),
    true,
  );
  assertEquals(
    profileBelongsToWorkspace({ id: "outside-user", active_workspace_id: "workspace-b" }, "workspace-a", memberIds),
    false,
  );
});

Deno.test("filterProfilesToWorkspace drops cross-workspace profiles", () => {
  const profiles = filterProfilesToWorkspace(
    [
      { id: "user-a", email: "a@example.test", active_workspace_id: "workspace-a" },
      { id: "user-b", email: "b@example.test", active_workspace_id: "workspace-b" },
      { id: "user-c", email: "c@example.test", active_workspace_id: "workspace-c" },
    ],
    "workspace-a",
    new Set(["user-c"]),
  );

  assertEquals(profiles.map((profile) => profile.id).sort(), ["user-a", "user-c"]);
});

Deno.test("filterAuthUsersToProfiles drops auth metadata for users outside caller workspace", () => {
  const authUsers = filterAuthUsersToProfiles(
    [
      { id: "user-a", last_sign_in_at: "2026-05-01T00:00:00Z" },
      { id: "user-b", last_sign_in_at: "2026-05-02T00:00:00Z" },
    ],
    new Set(["user-a"]),
  );

  assertEquals(authUsers, [{ id: "user-a", last_sign_in_at: "2026-05-01T00:00:00Z" }]);
});
